import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { createCherryIn } from '../cherryin-provider'

const mediaPrompt = (mediaType: string): LanguageModelV3CallOptions['prompt'] => [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Inspect the attachment.' },
      { type: 'file', data: new Uint8Array([1, 2, 3]), mediaType }
    ]
  }
]

async function captureRequestBody<T>(
  createModel: (fetch: typeof globalThis.fetch) => LanguageModelV3,
  mediaType: string
): Promise<T> {
  let requestBody: unknown
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    throw new Error('request captured')
  })

  await expect(createModel(fetch).doGenerate({ prompt: mediaPrompt(mediaType) })).rejects.toThrow('request captured')
  expect(fetch).toHaveBeenCalledOnce()
  expect(requestBody).toBeDefined()
  return requestBody as T
}

describe('CherryIN media wire formats', () => {
  it.each([
    ['audio/wav', 'wav'],
    ['audio/mpeg', 'mp3']
  ])('serializes supported OpenAI Chat %s as input_audio', async (mediaType, format) => {
    const body = await captureRequestBody<{ messages: Array<{ content: unknown[] }> }>(
      (fetch) =>
        createCherryIn({ apiKey: 'test-key', endpointType: 'openai', fetch }).languageModel('qwen/qwen3-omni-flash'),
      mediaType
    )

    expect(body.messages[0].content[1]).toEqual({
      type: 'input_audio',
      input_audio: { data: 'AQID', format }
    })
  })

  it.each(['audio/wav', 'audio/mpeg', 'audio/mp4', 'video/mp4'])(
    'preserves %s in Google Generate Content inlineData',
    async (mediaType) => {
      const body = await captureRequestBody<{
        contents: Array<{ parts: Array<{ inlineData?: unknown }> }>
      }>(
        (fetch) =>
          createCherryIn({ apiKey: 'test-key', endpointType: 'gemini', fetch }).languageModel(
            'google/gemini-2.5-flash'
          ),
        mediaType
      )

      expect(body.contents[0].parts[1].inlineData).toEqual({ data: 'AQID', mimeType: mediaType })
    }
  )
})
