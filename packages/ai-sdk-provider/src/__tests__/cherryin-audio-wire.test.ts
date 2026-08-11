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
  it('serializes supported OpenAI Chat WAV as input_audio', async () => {
    const body = await captureRequestBody<{ messages: Array<{ content: unknown[] }> }>(
      (fetch) =>
        createCherryIn({ apiKey: 'test-key', endpointType: 'openai', fetch }).languageModel('qwen/qwen3-omni-flash'),
      'audio/wav'
    )

    expect(body.messages[0].content[1]).toEqual({
      type: 'input_audio',
      input_audio: { data: 'AQID', format: 'wav' }
    })
  })

  it('preserves M4A in Google Generate Content inlineData', async () => {
    const body = await captureRequestBody<{
      contents: Array<{ parts: Array<{ inlineData?: unknown }> }>
    }>(
      (fetch) =>
        createCherryIn({ apiKey: 'test-key', endpointType: 'gemini', fetch }).languageModel('google/gemini-2.5-flash'),
      'audio/mp4'
    )

    expect(body.contents[0].parts[1].inlineData).toEqual({ data: 'AQID', mimeType: 'audio/mp4' })
  })
})
