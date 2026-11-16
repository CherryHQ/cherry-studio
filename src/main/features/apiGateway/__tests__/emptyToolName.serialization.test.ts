import { createOpenAI } from '@ai-sdk/openai'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { convertToModelMessages, generateText } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'

import { OpenAiMessageConverter } from '../adapters/converters/OpenAiMessageConverter'
import { OpenAiResponsesMessageConverter } from '../adapters/converters/OpenAiResponsesMessageConverter'

describe.each(['openai', 'openai-responses'] as const)('blank client tool serialization (%s)', (inputFormat) => {
  beforeEach(() => {
    mockMainLoggerService.warn.mockClear()
  })

  it('continues generation after filtering blank client tools', async () => {
    const names = ['', 'lookup', '   ', '\t\n', 'clock']
    const converted =
      inputFormat === 'openai'
        ? (() => {
            const converter = new OpenAiMessageConverter()
            const params = {
              model: 'openai:gpt-4.1',
              messages: [{ role: 'user' as const, content: 'Say OK.' }],
              tools: names.map((name) => ({ type: 'function' as const, function: { name } }))
            }
            return { messages: converter.toUIMessages(params), tools: converter.toAiSdkTools(params) }
          })()
        : (() => {
            const converter = new OpenAiResponsesMessageConverter()
            const params = {
              model: 'openai:gpt-4.1',
              input: 'Say OK.',
              tools: names.map((name) => ({ type: 'function' as const, name, parameters: null, strict: false }))
            }
            return { messages: converter.toUIMessages(params), tools: converter.toAiSdkTools(params) }
          })()

    let sent: { tools: Array<{ name: string }> } | undefined
    const model = createOpenAI({
      apiKey: 'fixture',
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as NonNullable<typeof sent>
        sent = body
        const blankIndex = body.tools.findIndex(({ name }) => name.trim().length === 0)
        if (blankIndex !== -1) {
          return Response.json(
            { error: { type: 'invalid_request_error', message: `Invalid 'tools[${blankIndex}].name': empty string` } },
            { status: 400 }
          )
        }
        return Response.json({
          id: 'resp_fixture',
          created_at: 0,
          model: 'gpt-4.1',
          output: [
            {
              id: 'msg_fixture',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'OK', annotations: [] }]
            }
          ],
          usage: { input_tokens: 1, output_tokens: 1 }
        })
      }
    }).responses('gpt-4.1')

    const generation = generateText({
      model,
      messages: await convertToModelMessages(converted.messages),
      tools: converted.tools,
      maxRetries: 0
    })

    await expect(generation.then(({ text }) => text)).resolves.toBe('OK')
    expect(sent?.tools.map(({ name }) => name)).toEqual(['lookup', 'clock'])
    expect(mockMainLoggerService.warn).toHaveBeenCalledExactlyOnceWith(
      'Dropped tools with empty or whitespace-only names before provider request',
      {
        inputFormat,
        model: 'openai:gpt-4.1',
        droppedTools: [
          {
            index: 0,
            path: inputFormat === 'openai' ? 'tools[0].function.name' : 'tools[0].name',
            name: '',
            description: undefined
          },
          {
            index: 2,
            path: inputFormat === 'openai' ? 'tools[2].function.name' : 'tools[2].name',
            name: '   ',
            description: undefined
          },
          {
            index: 3,
            path: inputFormat === 'openai' ? 'tools[3].function.name' : 'tools[3].name',
            name: '\t\n',
            description: undefined
          }
        ]
      }
    )
  })
})
