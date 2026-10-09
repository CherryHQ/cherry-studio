import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ImageOperation } from '@shared/data/types/model'

import { resolveAihubmixImageBinding } from '../aihubmix/aihubmixImageBinding'
import { createAihubmix } from '../aihubmix/aihubmixProvider'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='
const file = { type: 'file' as const, mediaType: 'image/png', data: PNG }
afterEach(() => vi.unstubAllGlobals())

function options(overrides: Partial<ImageModelV3CallOptions> = {}): ImageModelV3CallOptions {
  return {
    prompt: 'a fox',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerOptions: {},
    headers: undefined,
    abortSignal: undefined,
    ...overrides
  }
}

function model(
  modelId: string,
  operation: ImageOperation,
  response: unknown = { data: [{ url: 'https://images.example/output.png' }] }
) {
  const binding = resolveAihubmixImageBinding(modelId, operation, undefined)
  if (binding.kind === 'unavailable') throw new Error(binding.message)
  const requests: Request[] = []
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    requests.push(new Request(input, init))
    return Response.json(response)
  })
  return {
    requests,
    fetch,
    image: createAihubmix({
      baseURL: 'https://aihubmix.com/v1',
      apiKey: 'sk-test',
      fetch,
      imageBinding: binding.binding
    }).imageModel(modelId)
  }
}

// Wire contracts: https://docs.aihubmix.com/cn/api/IdeogramAI (retrieved 2026-09-09).
describe('bound AiHubMix image models', () => {
  // https://docs.aihubmix.com/cn/api/Image-Gen — Doubao integer seed/max_images bounds, retrieved 2026-09-09.
  it.each([-2, 2147483648, 0.5])('rejects invalid Doubao seed %s before HTTP instead of omitting it', async (seed) => {
    const { image, requests } = model('doubao-seedream-4-5', 'generate')
    await expect(image.doGenerate(options({ seed }))).rejects.toThrow()
    expect(requests).toHaveLength(0)
  })

  it.each([0, 16, 0.5])('rejects invalid Doubao maxImages %s before HTTP instead of omitting it', async (maxImages) => {
    const { image, requests } = model('doubao-seedream-4-5', 'generate')
    await expect(
      image.doGenerate(options({ providerOptions: { aihubmix: { sequentialImageGeneration: 'auto', maxImages } } }))
    ).rejects.toThrow()
    expect(requests).toHaveLength(0)
  })

  it.each([-1, 0, 2147483647])('preserves valid Doubao seed %s and explicit false', async (seed) => {
    const { image, requests } = model('doubao-seedream-4-5', 'generate')
    await image.doGenerate(options({ seed, providerOptions: { aihubmix: { addWatermark: false } } }))
    expect(await requests[0].json()).toMatchObject({ seed, watermark: false })
  })

  it.each([
    ['V_2', 'image_file'],
    ['ideogram/V3', 'image']
  ] as const)('converts a remote reference into the %s multipart input', async (modelId, field) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected global fetch')))
    const { image, requests, fetch } = model(modelId, 'remix')
    const downloads: Request[] = []
    fetch.mockImplementation(async (url, init) => {
      const request = new Request(url, init)
      if (request.method === 'GET') {
        downloads.push(request)
        return new Response(Buffer.from(PNG, 'base64'), { headers: { 'content-type': 'image/png' } })
      }
      requests.push(request)
      return Response.json({ data: [{ url: 'https://images.example/output.png' }] })
    })
    await image.doGenerate(options({ files: [{ type: 'url', url: 'https://images.example/reference.png' }] }))
    const input = (await requests[0].formData()).get(field)
    if (!(input instanceof File)) throw new Error('Missing downloaded reference')
    expect(Buffer.from(await input.arrayBuffer()).toString('base64')).toBe(PNG)
    expect(downloads).toHaveLength(1)
    expect(downloads[0].url).toBe('https://images.example/reference.png')
    expect(downloads[0].headers.get('Authorization')).toBeNull()
    expect(downloads[0].headers.get('Api-Key')).toBeNull()
  })

  it.each(['V_1', 'V_2', 'V_2_TURBO'] as const)(
    'sends the actual %s model ID and leaves omitted switches absent',
    async (modelId) => {
      const { image, requests } = model(modelId, 'generate')
      await image.doGenerate(options({ seed: 0 }))
      expect(requests[0].url).toBe('https://aihubmix.com/ideogram/generate')
      expect(await requests[0].json()).toEqual({
        image_request: { prompt: 'a fox', model: modelId, num_images: 1, seed: 0 }
      })
    }
  )

  it.each([
    ['V_1', 'remix', '/ideogram/remix', 'image_file'],
    ['V_2', 'remix', '/ideogram/remix', 'image_file'],
    ['V_2', 'upscale', '/ideogram/upscale', 'image_file'],
    ['ideogram/V3', 'remix', '/ideogram/v1/ideogram-v3/remix', 'image'],
    ['ideogram/V3', 'upscale', '/ideogram/upscale', 'image_file']
  ] as const)('preserves the input file for %s %s', async (modelId, operation, path, field) => {
    const { image, requests } = model(modelId, operation)
    await image.doGenerate(
      options({ files: [file], seed: 0, providerOptions: { aihubmix: { magicPromptOption: false, imageWeight: 20 } } })
    )
    expect(requests[0].url).toBe(`https://aihubmix.com${path}`)
    expect(requests[0].headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
    expect(requests[0].headers.get('Api-Key')).toBe('sk-test')
    const body = await requests[0].formData()
    const input = body.get(field)
    if (!(input instanceof File)) throw new Error('Missing multipart reference')
    expect(Buffer.from(await input.arrayBuffer()).toString('base64')).toBe(PNG)
    if (field === 'image') {
      expect(body.get('seed')).toBe('0')
      expect(body.get('magic_prompt')).toBe('OFF')
      expect(body.get('image_weight')).toBe('20')
    } else {
      expect(JSON.parse(String(body.get('image_request')))).toMatchObject({ seed: 0, magic_prompt_option: 'OFF' })
    }
  })

  it('does not infer a different protocol from a provider-options mode', async () => {
    const { image, requests } = model('gpt-image-1', 'generate')
    await expect(image.doGenerate(options({ providerOptions: { aihubmix: { mode: 'remix' } } }))).rejects.toThrow()
    expect(requests).toHaveLength(0)
  })

  it('reports an unsupported mask while executing the bound transport', async () => {
    const { image } = model('V_2', 'generate')
    const result = await image.doGenerate(options({ mask: file }))
    expect(result.warnings).toContainEqual({ type: 'unsupported', feature: 'mask' })
  })

  it('requires a real reference for a bound remix', async () => {
    const { image, requests } = model('V_2', 'remix')
    await expect(image.doGenerate(options())).rejects.toMatchObject({
      name: 'PaintingGenerateError',
      code: 'IMAGE_RETRY_REQUIRED'
    })
    expect(requests).toHaveLength(0)
  })

  // SDK wire contract: https://ai.google.dev/gemini-api/docs/image-generation (retrieved 2026-09-09).
  it('preserves Google delegation and its canonical image options', async () => {
    const { image, requests } = model('gemini-3-pro-image-preview', 'generate', {
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] } }]
    })
    const result = await image.doGenerate(
      options({ aspectRatio: '16:9', providerOptions: { aihubmix: { imageResolution: '2K' } } })
    )
    expect(requests[0].url).toBe('https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image-preview:generateContent')
    expect(await requests[0].json()).toMatchObject({
      generationConfig: { imageConfig: { aspectRatio: '16:9', imageSize: '2K' } }
    })
    expect(result.images).toEqual([PNG])
  })

  it('preserves Imagen person-generation options', async () => {
    const { image, requests } = model('imagen-4.0-generate-001', 'generate', {
      predictions: [{ bytesBase64Encoded: PNG }]
    })
    const result = await image.doGenerate(
      options({ aspectRatio: '1:1', providerOptions: { aihubmix: { personGeneration: 'ALLOW_ADULT' } } })
    )
    expect(await requests[0].json()).toMatchObject({
      parameters: { sampleCount: 1, personGeneration: 'allow_adult', aspectRatio: '1:1' }
    })
    expect(result.images).toEqual([PNG])
  })

  it('preserves provider and call headers on a custom request', async () => {
    const { image, requests } = model('ideogram/V3', 'generate')
    await image.doGenerate(options({ headers: { 'X-Image-Call': 'one' } }))
    expect(requests[0].headers.get('Authorization')).toBe('Bearer sk-test')
    expect(requests[0].headers.get('APP-Code')).toBe('MLTG2087')
    expect(requests[0].headers.get('X-Image-Call')).toBe('one')
  })

  it('propagates caller cancellation through the shared runtime', async () => {
    const { image, fetch } = model('V_2', 'generate')
    const controller = new AbortController()
    fetch.mockImplementation(async (_input, init) => {
      controller.abort()
      init?.signal?.throwIfAborted()
      throw new Error('Expected the transport request to carry the signal')
    })
    await expect(image.doGenerate(options({ abortSignal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError'
    })
  })

  it('preserves structured vendor failure messages', async () => {
    const { image, fetch } = model('V_2', 'generate')
    fetch.mockResolvedValue(Response.json({ message: 'account balance exhausted' }, { status: 403 }))
    await expect(image.doGenerate(options())).rejects.toMatchObject({
      code: 'REMOTE_ERROR',
      message: 'account balance exhausted'
    })
  })
})
