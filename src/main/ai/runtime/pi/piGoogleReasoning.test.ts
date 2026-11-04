import { normalizeContext } from '@earendil-works/pi-ai'
import type { Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/google-generative-ai'
import { describe, expect, it } from 'vitest'

describe('installed Pi Google reasoning wire', () => {
  it.each(['low', 'medium', 'high'] as const)(
    'sends Gemini 4 thinking level %s through custom fetch',
    async (reasoning) => {
      const model: Model<'google-generative-ai'> = {
        id: 'gemini-4-argon',
        name: 'Gemini 4 Argon',
        api: 'google-generative-ai',
        provider: 'google',
        baseUrl: 'https://gemini.test/v1beta',
        reasoning: true,
        thinkingLevelMap: {
          off: null,
          minimal: null,
          low: 'low',
          medium: 'medium',
          high: 'high',
          xhigh: null,
          max: null
        },
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1_048_576,
        maxTokens: 65_536
      }
      let body: { generationConfig?: { thinkingConfig?: Record<string, unknown> } } | undefined
      const result = await streamSimple(
        model,
        normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] }),
        {
          apiKey: 'test-key',
          reasoning,
          maxRetries: 0,
          fetch: async (_input, init) => {
            body = JSON.parse(String(init?.body))
            const response = {
              candidates: [{ content: { role: 'model', parts: [{ text: 'Hello back' }] }, finishReason: 'STOP' }],
              usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 }
            }
            return new Response(`data: ${JSON.stringify(response)}\n\n`, {
              headers: { 'Content-Type': 'text/event-stream' }
            })
          }
        }
      ).result()

      expect(result.stopReason).toBe('stop')
      expect(result.content).toContainEqual(expect.objectContaining({ type: 'text', text: 'Hello back' }))
      expect(body?.generationConfig?.thinkingConfig).toMatchObject({ thinkingLevel: reasoning.toUpperCase() })
      expect(body?.generationConfig?.thinkingConfig).not.toHaveProperty('thinkingBudget')
    }
  )
})
