import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { convertToModelMessages, generateText } from 'ai'
import { describe, expect, it } from 'vitest'

import { collectFileAttachments, prepareChatMessages } from '@main/ai/messages/attachmentRouting'

import { GeminiMessageConverter } from '../converters/GeminiMessageConverter'
import {
  OpenAiResponsesMessageConverter,
  type ResponsesCreateParams
} from '../converters/OpenAiResponsesMessageConverter'

const providers = ['responses', 'anthropic', 'compatible', 'google'] as const
const ingresses = ['responses-output', 'gemini-inline', 'gemini-function-media'] as const

describe('gateway text files reach pinned provider requests as full text', () => {
  for (const ingress of ingresses) {
    for (const mediaType of ['text/plain', 'text/markdown']) {
      it.each(providers)(`${ingress} / ${mediaType} reaches %s without file parts or truncation`, async (provider) => {
        const text = `  BEGIN中文\n${'article-body'.repeat(1000)}\nEND  `
        const data = Buffer.from(text).toString('base64')
        const blob = { mimeType: mediaType, data }
        const messages =
          ingress === 'responses-output'
            ? new OpenAiResponsesMessageConverter().toUIMessages({
                model: 'test',
                input: [
                  { type: 'function_call', call_id: 'call1', name: 'read_article', arguments: '{}' },
                  {
                    type: 'function_call_output',
                    call_id: 'call1',
                    output: [
                      { type: 'input_file', filename: 'article.txt', file_data: `data:${mediaType};base64,${data}` }
                    ]
                  }
                ] as ResponsesCreateParams['input']
              })
            : new GeminiMessageConverter().toUIMessages({
                contents:
                  ingress === 'gemini-inline'
                    ? [{ role: 'user', parts: [{ inlineData: blob }] }]
                    : [
                        { role: 'model', parts: [{ functionCall: { id: 'call1', name: 'read_article', args: {} } }] },
                        {
                          role: 'user',
                          parts: [
                            {
                              functionResponse: {
                                id: 'call1',
                                name: 'read_article',
                                response: {},
                                parts: [{ inlineData: blob }]
                              }
                            }
                          ]
                        }
                      ]
              })
        const attachments = collectFileAttachments(messages)
        expect(attachments).toEqual([])
        // AiService uses no attachment budget when contextOwner is caller (gateway).
        const prepared = await prepareChatMessages(messages, {
          attachments,
          nativeSupport: { image: false, pdf: false, audio: false, video: false },
          isToolCapable: true
        })
        expect(prepared.flatMap((message) => message.parts).some((part) => part.type === 'file')).toBe(false)
        const prompt = await convertToModelMessages(prepared)
        let body: unknown
        const captured = new Error('request captured without network')
        const settings = {
          apiKey: 'test-key',
          fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
            body = JSON.parse(String(init?.body))
            throw captured
          }
        }
        const model =
          provider === 'responses'
            ? createOpenAI(settings).responses('gpt-4.1')
            : provider === 'anthropic'
              ? createAnthropic(settings)('claude-sonnet-4-5')
              : provider === 'google'
                ? createGoogleGenerativeAI(settings)('gemini-2.5-flash')
                : createOpenAICompatible({ ...settings, name: 'test', baseURL: 'https://example.test/v1' }).chatModel(
                    'test'
                  )
        await expect(generateText({ model, messages: prompt, maxRetries: 0 })).rejects.toThrow(captured.message)
        const encoded = JSON.stringify(body)
        expect(encoded).toContain(JSON.stringify(text).slice(1, -1))
        expect(encoded).not.toContain('base64')
        expect(encoded).not.toContain('[Truncated')
        expect(encoded).not.toContain('read_file(')
      })
    }
  }
})

describe('pinned adapter controls for unnormalized text file parts', () => {
  for (const mediaType of ['text/plain', 'text/markdown']) {
    it.each(providers)(`${mediaType} file part acceptance on %s`, async (provider) => {
      let dispatched = false
      const captured = new Error('control request captured without network')
      const settings = {
        apiKey: 'test-key',
        fetch: async () => {
          dispatched = true
          throw captured
        }
      }
      const model =
        provider === 'responses'
          ? createOpenAI(settings).responses('gpt-4.1')
          : provider === 'anthropic'
            ? createAnthropic(settings)('claude-sonnet-4-5')
            : provider === 'google'
              ? createGoogleGenerativeAI(settings)('gemini-2.5-flash')
              : createOpenAICompatible({ ...settings, name: 'test', baseURL: 'https://example.test/v1' }).chatModel(
                  'test'
                )
      const messages = await convertToModelMessages([
        {
          id: 'raw-file',
          role: 'user',
          parts: [
            {
              type: 'file',
              mediaType,
              url: `data:${mediaType};base64,${Buffer.from('hello').toString('base64')}`,
              filename: 'note.txt'
            }
          ]
        }
      ])
      const result = generateText({ model, messages, maxRetries: 0 })
      if (provider === 'responses' || (provider === 'anthropic' && mediaType !== 'text/plain')) {
        await expect(result).rejects.toMatchObject({ name: 'AI_UnsupportedFunctionalityError' })
        expect(dispatched).toBe(false)
      } else {
        await expect(result).rejects.toThrow(captured.message)
        expect(dispatched).toBe(true)
      }
    })
  }
})
