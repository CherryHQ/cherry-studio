import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it, vi } from 'vitest'

describe('OpenAI image response compatibility', () => {
  it.each([
    {
      name: 'URL response',
      data: [{ url: 'https://cdn.example.com/generated.png' }],
      expected: ['https://cdn.example.com/generated.png']
    },
    {
      name: 'base64 response',
      data: [{ b64_json: 'aGVsbG8=' }],
      expected: ['aGVsbG8=']
    },
    {
      name: 'mixed response with base64 taking precedence',
      data: [
        { url: 'https://cdn.example.com/fallback.png', b64_json: 'aGVsbG8=' },
        { url: 'https://cdn.example.com/second.png' }
      ],
      expected: ['aGVsbG8=', 'https://cdn.example.com/second.png']
    }
  ])('accepts $name', async ({ data, expected }) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )
    const openai = createOpenAI({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      fetch
    })

    const result = await openai.imageModel('gpt-image-2').doGenerate({
      prompt: 'test image',
      n: 1,
      size: undefined,
      aspectRatio: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: {},
      headers: undefined,
      abortSignal: undefined
    })

    expect(result.images).toEqual(expected)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
