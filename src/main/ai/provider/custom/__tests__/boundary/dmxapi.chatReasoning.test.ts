import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createDmxapiProvider } from '../../dmxapi/dmxapiProvider'
import { captureWithFetch } from './captureRequest'

const PROMPT: LanguageModelV3CallOptions['prompt'] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]

describe('DMXAPI chat boundary', () => {
  it('serializes compat reasoning from providerOptions.dmxapi', async () => {
    const req = await captureWithFetch((fetch) =>
      createDmxapiProvider({ apiKey: 'sk', baseURL: 'https://www.dmxapi.cn/v1', fetch })
        .languageModel('qwen3.5-plus')
        .doGenerate({
          prompt: PROMPT,
          providerOptions: { dmxapi: { reasoningEffort: 'high' } }
        })
    )

    expect(req.url).toBe('https://www.dmxapi.cn/v1/chat/completions')
    expect(req.body).toMatchObject({ model: 'qwen3.5-plus', reasoning_effort: 'high' })
  })

  it('serializes native OpenAI reasoning from providerOptions.openai', async () => {
    const req = await captureWithFetch((fetch) =>
      createDmxapiProvider({ apiKey: 'sk', baseURL: 'https://www.dmxapi.cn/v1', fetch })
        .languageModel('gpt-5')
        .doGenerate({
          prompt: PROMPT,
          providerOptions: { openai: { reasoningEffort: 'high' } }
        })
    )

    expect(req.url).toBe('https://www.dmxapi.cn/v1/chat/completions')
    expect(req.body).toMatchObject({ model: 'gpt-5', reasoning_effort: 'high' })
  })

  it('derives the Gemini v1beta base from the shared configured chat base', async () => {
    const req = await captureWithFetch((fetch) =>
      createDmxapiProvider({ apiKey: 'sk', baseURL: 'https://www.dmxapi.cn/v1', fetch })
        .languageModel('gemini-2.5-pro')
        .doGenerate({ prompt: PROMPT })
    )

    expect(req.url).toMatch(/^https:\/\/www\.dmxapi\.cn\/v1beta\/models\/gemini-2\.5-pro/)
  })

  it('uses the resolved Gemini endpoint when Chat and Gemini point at different proxies', async () => {
    const req = await captureWithFetch((fetch) =>
      createDmxapiProvider({
        apiKey: 'sk',
        baseURL: 'https://gemini.dmx.example/custom/v1beta',
        endpointBaseURLs: {
          'google-generate-content': 'https://gemini.dmx.example/custom/v1beta',
          'openai-chat-completions': 'https://chat.dmx.example/v1'
        },
        fetch
      })
        .languageModel('gemini-2.5-pro')
        .doGenerate({ prompt: PROMPT })
    )

    expect(req.url).toMatch(/^https:\/\/gemini\.dmx\.example\/custom\/v1beta\/models\/gemini-2\.5-pro/)
  })
})
