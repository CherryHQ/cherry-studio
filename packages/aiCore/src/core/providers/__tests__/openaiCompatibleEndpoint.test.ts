import { generateText } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { extensionRegistry } from '../index'

describe('openai-compatible custom endpoint', () => {
  afterEach(() => {
    extensionRegistry.get('openai-compatible')?.clearCache()
  })

  it('uses the configured endpoint for image generation requests', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    const provider = await extensionRegistry.createProvider('openai-compatible', {
      apiKey: 'sk-test',
      baseURL: 'https://api.example.com',
      name: 'custom-openai-compatible',
      customEndpoint: 'images/generations',
      fetch: fetchSpy
    } as any)

    const imageModel = provider.imageModel('gpt-image-2')

    await imageModel.doGenerate({
      prompt: 'cat',
      n: 1,
      size: '1024x1024',
      aspectRatio: undefined,
      seed: undefined,
      providerOptions: {},
      headers: {},
      files: undefined,
      mask: undefined
    })

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined]

    expect(url).toBe('https://api.example.com/images/generations')
  })

  it('keeps chat requests on the default chat endpoint when a custom image endpoint is configured', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          created: 0,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop'
            }
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    )

    const provider = await extensionRegistry.createProvider('openai-compatible', {
      apiKey: 'sk-test',
      baseURL: 'https://api.example.com',
      name: 'custom-openai-compatible',
      customEndpoint: 'images/generations',
      fetch: fetchSpy
    } as any)

    await generateText({
      model: provider.languageModel('gpt-4o-mini') as any,
      prompt: 'hello'
    })

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined]

    expect(url).toBe('https://api.example.com/chat/completions')
  })
})
