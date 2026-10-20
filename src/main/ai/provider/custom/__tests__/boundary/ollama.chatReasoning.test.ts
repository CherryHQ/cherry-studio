import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createOllamaWithImageModel } from '../../ollama/ollamaProvider'
import { captureWithFetch } from './captureRequest'

const PROMPT: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]

describe('Ollama chat reasoning boundary', () => {
  it('leaves thinking unset when no reasoning option is selected', async () => {
    const request = await captureWithFetch((fetch) =>
      createOllamaWithImageModel({ baseURL: 'https://ollama.example/api', fetch })
        .languageModel('qwen3:8b')
        .doGenerate({ prompt: PROMPT })
    )

    expect(request.url).toBe('https://ollama.example/api/chat')
    expect(request.body).not.toHaveProperty('think')
  })

  it('sends think false when thinking is explicitly disabled', async () => {
    const request = await captureWithFetch((fetch) =>
      createOllamaWithImageModel({ baseURL: 'https://ollama.example/api', fetch })
        .languageModel('qwen3:8b')
        .doGenerate({
          prompt: PROMPT,
          providerOptions: { ollama: { think: false } }
        })
    )

    expect(request.body).toHaveProperty('think', false)
  })
})
