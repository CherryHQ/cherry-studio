import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { describe, expect, it, vi } from 'vitest'

const audioPrompt = (mediaType: string): LanguageModelV3CallOptions['prompt'] => [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Inspect the attachment.' },
      { type: 'file', data: new Uint8Array([1, 2, 3]), mediaType }
    ]
  }
]

async function captureRequestBody<T>(
  modelFactory: (fetch: typeof globalThis.fetch) => LanguageModelV3,
  mediaType: string
): Promise<T> {
  let requestBody: unknown
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    requestBody = JSON.parse(String(init?.body))
    throw new Error('request captured')
  })

  await expect(modelFactory(fetch).doGenerate({ prompt: audioPrompt(mediaType) })).rejects.toThrow('request captured')
  expect(fetch).toHaveBeenCalledOnce()
  expect(requestBody).toBeDefined()
  return requestBody as T
}

describe('OpenRouter audio input', () => {
  it.each([
    ['audio/wav', 'wav'],
    ['audio/mpeg', 'mp3']
  ])('serializes supported %s as input_audio', async (mediaType, format) => {
    const body = await captureRequestBody<{ messages: Array<{ content: unknown[] }> }>(
      (fetch) => createOpenRouter({ apiKey: 'test-key', fetch })('openai/gpt-audio'),
      mediaType
    )

    expect(body.messages[0].content[1]).toEqual({
      type: 'input_audio',
      input_audio: { data: 'AQID', format }
    })
  })
})
