import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createVertex } from '@ai-sdk/google-vertex'
import { generateText, streamText } from 'ai'
import { describe, expect, it } from 'vitest'

import { getContextTokens } from '@cherrystudio/ai-core'

function createContinuedModel(streaming: boolean, namespace: 'google' | 'vertex') {
  const requests: Record<string, any>[] = []
  const urls: string[] = []
  const responses = [
    {
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'Hello ' }] },
          finishReason: 'CONTINUATION',
          continuationToken: 'hop-2'
        }
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 2, thoughtsTokenCount: 1, totalTokenCount: 103 }
    },
    {
      candidates: [{ content: { role: 'model', parts: [{ text: 'world' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 103, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 108 }
    }
  ]
  const createProvider = namespace === 'google' ? createGoogleGenerativeAI : createVertex
  const provider = createProvider({
    apiKey: 'test-key',
    baseURL: 'https://gemini.test/v1beta',
    fetch: async (url, init) => {
      urls.push(String(url))
      requests.push(JSON.parse(String(init?.body)))
      const response = responses[requests.length - 1]
      if (!response) throw new Error('Unexpected extra continuation request')
      return streaming
        ? new Response(`data: ${JSON.stringify(response)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
        : Response.json(response)
    }
  })
  return { model: provider('google/gemini-4-argon'), requests, urls }
}

describe('installed Gemini 4 adapter', () => {
  it.each([
    { streaming: false, namespace: 'google' },
    { streaming: true, namespace: 'google' },
    { streaming: false, namespace: 'vertex' },
    { streaming: true, namespace: 'vertex' }
  ] as const)(
    'continues $namespace responses with streaming=$streaming and preserves context accounting',
    async ({ streaming, namespace }) => {
      const { model, requests, urls } = createContinuedModel(streaming, namespace)
      const options = {
        model,
        prompt: 'Say hello',
        maxOutputTokens: 131072,
        maxRetries: 0,
        providerOptions: { [namespace]: { thinkingConfig: { thinkingLevel: 'medium' } } }
      }
      const result = streaming ? streamText(options) : await generateText(options)
      if ('consumeStream' in result) await result.consumeStream()
      expect(await result.text).toBe('Hello world')
      expect(requests).toHaveLength(2)
      expect(requests[0]).not.toHaveProperty('continuationToken')
      expect(requests[1]).toMatchObject({
        continuationToken: 'hop-2',
        generationConfig: { maxOutputTokens: 131072, thinkingConfig: { thinkingLevel: 'medium' } }
      })
      expect(urls.every((url) => url.includes('/models/google/gemini-4-argon:'))).toBe(true)
      const usage = await result.usage
      const metadata = await result.providerMetadata
      expect(usage).toMatchObject({
        inputTokens: 203,
        outputTokens: 8,
        totalTokens: 211,
        outputTokenDetails: { reasoningTokens: 3 }
      })
      expect(metadata?.[namespace]?.initialPromptTokenCount).toBe(100)
      expect(getContextTokens(usage, metadata)).toBe(108)
      expect(await result.finishReason).toBe('stop')
      expect(metadata?.[namespace]?.continuationToken).toBeUndefined()
    }
  )
})
