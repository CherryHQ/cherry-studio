import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { LanguageModelMiddleware } from 'ai'
import { describe, expect, it } from 'vitest'

import type { RequestScope } from '../../scope'
import {
  createDeepseekResponsesReasoningReplayPlugin,
  deepseekResponsesReasoningReplayFeature
} from '../deepseekResponsesReasoningReplay'

async function getMiddleware(): Promise<LanguageModelMiddleware> {
  const plugin = createDeepseekResponsesReasoningReplayPlugin()
  const ctx = { middlewares: [] as LanguageModelMiddleware[] }
  await plugin.configureContext?.(ctx as any)
  expect(ctx.middlewares).toHaveLength(1)
  return ctx.middlewares[0]
}

async function transform(prompt: LanguageModelV3Prompt): Promise<LanguageModelV3Prompt> {
  const middleware = await getMiddleware()
  const result = await middleware.transformParams!({
    type: 'stream',
    params: { prompt } as any,
    model: {} as any
  })
  return result.prompt
}

async function captureResponsesRequest(prompt: LanguageModelV3Prompt) {
  let requestBody: { input?: Array<Record<string, unknown>> } | undefined
  const sdkModel = createOpenAI({
    apiKey: 'sk-test',
    baseURL: 'https://example.com/v1',
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          id: 'resp_1',
          created_at: 0,
          model: 'deepseek-v4-flash',
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              id: 'msg_1',
              content: [
                {
                  type: 'output_text',
                  text: 'It is sunny in Shenzhen.',
                  annotations: [],
                  logprobs: null
                }
              ]
            }
          ],
          usage: { input_tokens: 1, output_tokens: 1 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
  }).responses('deepseek-v4-flash')

  const result = await sdkModel.doGenerate({ prompt, providerOptions: { openai: { store: false } } })
  return { input: requestBody?.input ?? [], result }
}

const model = (id: string): Model => ({ id, apiModelId: id, providerId: 'cherryin', name: id }) as Model

describe('deepseekResponsesReasoningReplay', () => {
  describe('applies', () => {
    const scope = (endpointType: string, modelId: string) =>
      ({ endpointType, model: model(modelId) }) as unknown as RequestScope

    it('activates for DeepSeek models on the Responses endpoint, including agent/ prefixed ids', () => {
      expect(
        deepseekResponsesReasoningReplayFeature.applies!(scope(ENDPOINT_TYPE.OPENAI_RESPONSES, 'deepseek-v4-flash'))
      ).toBe(true)
      expect(
        deepseekResponsesReasoningReplayFeature.applies!(
          scope(ENDPOINT_TYPE.OPENAI_RESPONSES, 'agent/deepseek-v4-flash')
        )
      ).toBe(true)
    })

    it('stays inactive for other endpoints and non-DeepSeek models', () => {
      expect(
        deepseekResponsesReasoningReplayFeature.applies!(
          scope(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'deepseek-v4-flash')
        )
      ).toBe(false)
      expect(deepseekResponsesReasoningReplayFeature.applies!(scope(ENDPOINT_TYPE.OPENAI_RESPONSES, 'gpt-5'))).toBe(
        false
      )
    })
  })

  describe('transformParams', () => {
    it('tags metadata-less assistant reasoning parts for raw passback', async () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'thinking about it' },
            { type: 'text', text: 'answer' }
          ]
        }
      ]
      const result = await transform(prompt)
      const assistant = result[0]
      expect(assistant.role).toBe('assistant')
      expect(assistant.content[0]).toMatchObject({
        type: 'reasoning',
        providerOptions: { openai: { rawReasoningContent: true } }
      })
      // Non-reasoning parts untouched.
      expect(assistant.content[1]).toEqual({ type: 'text', text: 'answer' })
    })

    it('uses raw replay for item-id-only stream metadata but preserves encrypted native replay', async () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'a', providerOptions: { openai: { itemId: 'rs_1' } } },
            { type: 'reasoning', text: 'b', providerOptions: { openai: { reasoningEncryptedContent: 'enc' } } }
          ]
        }
      ]
      const result = await transform(prompt)
      expect(result[0].content[0]).toEqual({
        type: 'reasoning',
        text: 'a',
        providerOptions: { openai: { itemId: undefined, rawReasoningContent: true } }
      })
      expect(result[0].content[1]).toEqual({
        type: 'reasoning',
        text: 'b',
        providerOptions: { openai: { reasoningEncryptedContent: 'enc' } }
      })
    })

    it('preserves other providerOptions namespaces when tagging', async () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: 'assistant',
          content: [{ type: 'reasoning', text: 'hmm', providerOptions: { anthropic: { signature: 's' } } }]
        }
      ]
      const result = await transform(prompt)
      expect(result[0].content[0]).toMatchObject({
        providerOptions: { anthropic: { signature: 's' }, openai: { rawReasoningContent: true } }
      })
    })

    it('does not touch user messages', async () => {
      const prompt: LanguageModelV3Prompt = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
      expect(await transform(prompt)).toEqual(prompt)
    })

    it('keeps raw reasoning in a store:false tool continuation request', async () => {
      const prompt: LanguageModelV3Prompt = [
        { role: 'user', content: [{ type: 'text', text: 'Look up the weather.' }] },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'I should call the weather tool.' },
            { type: 'tool-call', toolCallId: 'call_1', toolName: 'get_weather', input: { city: 'Shenzhen' } }
          ]
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'get_weather',
              output: { type: 'text', value: 'Sunny, 30C' }
            }
          ]
        }
      ]

      const { input, result } = await captureResponsesRequest(await transform(prompt))

      expect(input).toEqual(
        expect.arrayContaining([
          {
            type: 'reasoning',
            summary: [],
            content: [{ type: 'reasoning_text', text: 'I should call the weather tool.' }]
          },
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'get_weather',
            arguments: '{"city":"Shenzhen"}'
          },
          { type: 'function_call_output', call_id: 'call_1', output: 'Sunny, 30C' }
        ])
      )
      expect(result.content).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'It is sunny in Shenzhen.' })])
      )
      expect(result.warnings).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('without encrypted content') })
        ])
      )
    })

    it('keeps streamed item-id reasoning in a store:false continuation request', async () => {
      const prompt: LanguageModelV3Prompt = [
        { role: 'user', content: [{ type: 'text', text: 'Continue.' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'Reasoning emitted by response.reasoning_text.delta.',
              providerOptions: { openai: { itemId: 'rs_stream_1' } }
            },
            { type: 'text', text: 'First answer.' }
          ]
        },
        { role: 'user', content: [{ type: 'text', text: 'Now continue.' }] }
      ]

      const { input } = await captureResponsesRequest(await transform(prompt))

      expect(input).toEqual(
        expect.arrayContaining([
          {
            type: 'reasoning',
            summary: [],
            content: [{ type: 'reasoning_text', text: 'Reasoning emitted by response.reasoning_text.delta.' }]
          }
        ])
      )
      expect(input).not.toEqual(expect.arrayContaining([{ type: 'reasoning', id: 'rs_stream_1' }]))
    })

    it('keeps tagged replay content while filtering an untagged reasoning item', async () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'Replay this reasoning.',
              providerOptions: { openai: { rawReasoningContent: true } }
            },
            { type: 'reasoning', text: 'Do not replay this untagged reasoning.' },
            { type: 'text', text: 'Answer.' }
          ]
        }
      ]

      const { input, result } = await captureResponsesRequest(prompt)
      const replayedReasoning = input.filter((item) => item.type === 'reasoning')

      expect(replayedReasoning).toEqual([
        {
          type: 'reasoning',
          summary: [],
          content: [{ type: 'reasoning_text', text: 'Replay this reasoning.' }]
        }
      ])
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('Do not replay this untagged reasoning.')
          })
        ])
      )
    })
  })
})
