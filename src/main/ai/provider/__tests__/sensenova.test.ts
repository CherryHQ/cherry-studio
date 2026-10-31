import { OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import { APICallError, type ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { createSenseNovaImageFetch } from '../sensenova'

const baseURL = 'https://token.sensenova.cn/v1'
const options: ImageModelV3CallOptions = {
  prompt: 'replace the background with a glacier',
  n: 1,
  size: undefined,
  aspectRatio: undefined,
  seed: undefined,
  providerOptions: {},
  files: [{ type: 'file', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) }],
  mask: undefined
}

function model(fetch: typeof globalThis.fetch, host = baseURL) {
  return new OpenAICompatibleImageModel('sensenova-u1.5-fast', {
    provider: 'sensenova.image',
    url: ({ path }) => `${host}${path}`,
    headers: () => ({ Authorization: 'Bearer test-key' }),
    fetch: createSenseNovaImageFetch(fetch)
  })
}

describe('SenseNova image-edit wire contract', () => {
  // Catches the reported multipart/schema rejection using the actual SDK serializer.
  it('sends JSON data URLs in reference order and returns the edited image', async () => {
    const signal = new AbortController().signal
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('Content-Type')).toBe('application/json')
      expect(headers.get('Authorization')).toBe('Bearer test-key')
      expect(init?.signal).toBe(signal)
      expect(JSON.parse(String(init?.body))).toEqual({
        model: 'sensenova-u1.5-fast',
        prompt: options.prompt,
        n: 1,
        images: [{ image_url: 'data:image/png;base64,AQID' }, { image_url: 'data:image/jpeg;base64,BA==' }],
        response_format: 'b64_json',
        watermark: false,
        prompt_extend: true,
        size: 'auto'
      })
      return Response.json({ data: [{ b64_json: 'edited-image' }] })
    })
    const result = await model(fetch).doGenerate({
      ...options,
      files: [...options.files!, { type: 'file', mediaType: 'image/jpeg', data: new Uint8Array([4]) }],
      abortSignal: signal,
      providerOptions: { sensenova: { watermark: false, prompt_extend: true, size: 'auto' } }
    })
    expect(result.images).toEqual(['edited-image'])
  })

  it('handles the SDK single-image field without array brackets', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body)).images).toEqual([{ image_url: 'data:image/png;base64,AQID' }])
      return Response.json({ data: [{ b64_json: 'image' }] })
    })
    await model(fetch).doGenerate(options)
  })

  it('keeps other hosts on multipart and SenseNova text-to-image on JSON', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input).startsWith('https://example.com')) {
        expect(init?.body).toBeInstanceOf(FormData)
      } else {
        expect(String(input)).toBe(`${baseURL}/images/generations`)
        expect(JSON.parse(String(init?.body))).not.toHaveProperty('images')
      }
      return Response.json({ data: [{ b64_json: 'image' }] })
    })
    await model(fetch, 'https://example.com/v1').doGenerate(options)
    await model(fetch).doGenerate({ ...options, files: undefined })
  })

  it('retains the vendor error response body for diagnostics', async () => {
    const responseBody = '{"error":{"message":"invalid arguments","type":"invalid_request_error","code":"3"}}'
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(responseBody, { status: 400 }))
    try {
      await model(fetch).doGenerate(options)
      expect.fail('expected the vendor error')
    } catch (error) {
      expect(APICallError.isInstance(error)).toBe(true)
      expect(error).toMatchObject({ statusCode: 400, responseBody, message: 'invalid arguments' })
    }
  })

  it.each([{ mask: options.files![0] }, { n: 2 }, { files: Array.from({ length: 6 }, () => options.files![0]) }])(
    'rejects unsupported edit inputs before submitting them: %o',
    async (overrides) => {
      const fetch = vi.fn<typeof globalThis.fetch>()
      await expect(model(fetch).doGenerate({ ...options, ...overrides })).rejects.toThrow(/SenseNova/)
      expect(fetch).not.toHaveBeenCalled()
    }
  )
})
