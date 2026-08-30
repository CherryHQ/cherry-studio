import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { createOllama } from 'ollama-ai-provider-v2'
import { describe, expect, it } from 'vitest'

const prompt: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]

async function captureRequest(options: Omit<LanguageModelV3CallOptions, 'prompt'> = {}) {
  let body: Record<string, unknown> | undefined
  const fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return new Response('{}', { status: 200 })
  }) as typeof globalThis.fetch

  try {
    await createOllama({ baseURL: 'https://ollama.example/api', fetch })
      .languageModel('qwen3:8b')
      .doGenerate({ prompt, ...options } as LanguageModelV3CallOptions)
  } catch {
    // The response is intentionally empty; this test only asserts the outbound protocol.
  }

  return body
}

describe('Ollama reasoning request', () => {
  it('leaves thinking unset when no reasoning option is selected', async () => {
    expect(await captureRequest()).not.toHaveProperty('think')
  })

  it('sends think false when thinking is explicitly disabled', async () => {
    expect(await captureRequest({ providerOptions: { ollama: { think: false } } })).toHaveProperty('think', false)
  })
})
