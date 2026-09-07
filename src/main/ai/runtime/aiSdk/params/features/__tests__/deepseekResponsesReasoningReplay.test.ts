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

    it('leaves reasoning parts with a native OpenAI round-trip alone', async () => {
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
        providerOptions: { openai: { itemId: 'rs_1' } }
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
  })
})
