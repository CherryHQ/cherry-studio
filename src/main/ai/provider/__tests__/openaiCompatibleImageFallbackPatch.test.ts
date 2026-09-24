import { OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

const callOptions: ImageModelV3CallOptions = {
  prompt: 'a cherry tree',
  n: 1,
  size: undefined,
  aspectRatio: undefined,
  seed: undefined,
  providerOptions: {},
  headers: undefined,
  abortSignal: undefined,
  files: undefined,
  mask: undefined
}

function createModel(fetch: typeof globalThis.fetch) {
  return new OpenAICompatibleImageModel('imagen-3', {
    provider: 'openai-compatible.image',
    url: ({ path }) => `https://example.com/v1${path}`,
    headers: () => ({ Authorization: 'Bearer sk-test' }),
    fetch
  })
}

function errorResponse(status: 400 | 422, message: string) {
  return new Response(
    JSON.stringify({ error: { message, type: 'invalid_request_error', code: 'invalid_parameter' } }),
    { status, headers: { 'content-type': 'application/json' } }
  )
}

describe('patched openai-compatible image response_format fallback', () => {
  it.each([400, 422] as const)('retries an explicit response_format rejection with status %s', async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(errorResponse(status, "Unsupported parameter: 'response_format'"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/image.png' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

    const result = await createModel(fetch).doGenerate(callOptions)

    expect(result.images).toEqual(['https://cdn.example.com/image.png'])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ response_format: 'b64_json' })
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).not.toHaveProperty('response_format')
  })

  it.each([400, 422] as const)('does not retry an unrelated request failure with status %s', async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(errorResponse(status, 'Content policy violation'))

    await expect(createModel(fetch).doGenerate(callOptions)).rejects.toThrow('Content policy violation')

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
