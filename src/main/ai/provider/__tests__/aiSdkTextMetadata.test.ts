import { createRequire } from 'node:module'

import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { streamText } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { expect, it } from 'vitest'

const commonJs: { streamText: typeof streamText } = createRequire(import.meta.url)('ai')

it.each([
  { bundle: 'ESM', generate: streamText },
  { bundle: 'CommonJS', generate: commonJs.streamText }
])('preserves metadata-only text updates through the $bundle AI SDK stream', async ({ generate }) => {
  const providerMetadata = { google: { thoughtSignature: 'opaque-native-signature' } }
  const parts: LanguageModelV3StreamPart[] = [
    { type: 'text-start', id: 'answer' },
    { type: 'text-delta', id: 'answer', delta: 'answer' },
    { type: 'text-delta', id: 'answer', delta: '' },
    { type: 'text-delta', id: 'answer', delta: '', providerMetadata },
    { type: 'text-end', id: 'answer' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined }
      }
    }
  ]
  const result = generate({
    model: new MockLanguageModelV3({ doStream: async () => ({ stream: convertArrayToReadableStream(parts) }) }),
    prompt: 'answer'
  })
  const chunks = await Array.fromAsync(result.toUIMessageStream())
  expect(chunks.filter((chunk) => chunk.type === 'text-delta')).toEqual([
    { type: 'text-delta', id: 'answer', delta: 'answer' },
    { type: 'text-delta', id: 'answer', delta: '', providerMetadata }
  ])
  expect(await result.text).toBe('answer')
  expect(await result.content).toEqual([{ type: 'text', text: 'answer', providerMetadata }])
})
