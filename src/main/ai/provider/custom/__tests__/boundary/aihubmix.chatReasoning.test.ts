/**
 * Wire-level guard for the AiHubMix compat chat route: options written under
 * `providerOptions.aihubmix` must reach the request body. The route's provider
 * string is `aihubmix.chat` — if it ever drifts (e.g. back to
 * `openai-compatible.aihubmix`), `providerOptionsName` stops matching the
 * namespace the app writes and every option silently vanishes from the wire.
 */
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createAihubmix } from '../../aihubmix/aihubmixProvider'
import { captureWithFetch } from './captureRequest'

const PROMPT: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]

describe('AiHubMix chat boundary — providerOptions.aihubmix reaches the wire', () => {
  it("serializes reasoningEffort 'none' from the aihubmix namespace as reasoning_effort", async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmix({ apiKey: 'sk', fetch })
        .languageModel('glm-5')
        .doGenerate({
          prompt: PROMPT,
          providerOptions: { aihubmix: { reasoningEffort: 'none' } }
        } as LanguageModelV3CallOptions)
    )

    expect(req.url).toBe('https://aihubmix.com/v1/chat/completions')
    expect(req.body).toMatchObject({ model: 'glm-5', reasoning_effort: 'none' })
  })

  it('passes unknown aihubmix-namespace fields through to the body alongside an effort tier', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmix({ apiKey: 'sk', fetch })
        .languageModel('deepseek-v4')
        .doGenerate({
          prompt: PROMPT,
          providerOptions: { aihubmix: { reasoningEffort: 'high', enable_thinking: true } }
        } as LanguageModelV3CallOptions)
    )

    expect(req.body).toMatchObject({ model: 'deepseek-v4', reasoning_effort: 'high', enable_thinking: true })
  })
})

describe('AiHubMix Gemini boundary — baseURL derives from the configured gateway URL', () => {
  it('routes the Gemini surface through a user-configured proxy baseURL', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmix({ apiKey: 'sk', baseURL: 'https://proxy.example.com/v1', fetch })
        .languageModel('gemini-2.5-pro')
        .doGenerate({ prompt: PROMPT } as LanguageModelV3CallOptions)
    )

    expect(req.url).toMatch(/^https:\/\/proxy\.example\.com\/gemini\/v1beta\/models\/gemini-2\.5-pro/)
  })

  it('keeps the official Gemini surface for the default baseURL', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmix({ apiKey: 'sk', fetch })
        .languageModel('gemini-2.5-pro')
        .doGenerate({ prompt: PROMPT } as LanguageModelV3CallOptions)
    )

    expect(req.url).toMatch(/^https:\/\/aihubmix\.com\/gemini\/v1beta\/models\/gemini-2\.5-pro/)
  })
})
