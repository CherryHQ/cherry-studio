import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { describe, expect, it } from 'vitest'

import { createDeepseekResponsesReasoningReplayPlugin } from '../deepseekResponsesReasoningReplay'

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
    params: { prompt },
    model: {} as any
  })
  return result.prompt
}

describe('deepseekResponsesReasoningReplay', () => {
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

    it('tags item-backed reasoning for raw passback but preserves encrypted reasoning', async () => {
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
        providerOptions: { openai: { itemId: 'rs_1', rawReasoningContent: true } }
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
