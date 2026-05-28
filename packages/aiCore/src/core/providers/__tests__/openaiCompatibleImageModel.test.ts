import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

describe('openai-compatible image model requests', () => {
  it('does not send response_format for image generation requests', async () => {
    let requestBody: Record<string, unknown> | undefined

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body))

      return new Response(JSON.stringify({ data: [{ b64_json: 'base64-image-data' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })

    const provider = createOpenAICompatible({
      name: 'test-openai-compatible',
      apiKey: 'test-key',
      baseURL: 'https://example.com/v1',
      fetch: fetchMock
    })

    const model = provider.imageModel('custom-image-model')
    const request: ImageModelV3CallOptions = {
      prompt: 'Draw a landscape',
      n: 1,
      size: undefined,
      aspectRatio: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: {}
    }

    const result = await model.doGenerate(request)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(requestBody).toMatchObject({
      model: 'custom-image-model',
      prompt: 'Draw a landscape'
    })
    expect(requestBody).not.toHaveProperty('response_format')
    expect(result.images).toEqual(['base64-image-data'])
  })
})
