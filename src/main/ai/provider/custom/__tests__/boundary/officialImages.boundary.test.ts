import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { ImageModelV3, ImageModelV3CallOptions } from '@ai-sdk/provider'
import { createXai } from '@ai-sdk/xai'
import { describe, expect, it } from 'vitest'

import { createDmxapiProvider } from '../../dmxapi/dmxapiProvider'
import { buildVendorProviderOptions } from '../../wire/buildImageRequest'
import { WIRE_REGISTRY } from '../../wire/wireProfile'

function options(extra: Partial<ImageModelV3CallOptions> = {}): ImageModelV3CallOptions {
  return {
    prompt: 'a blue square',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    providerOptions: {},
    headers: undefined,
    abortSignal: undefined,
    files: undefined,
    mask: undefined,
    ...extra
  }
}
async function capture(factory: (fetch: typeof globalThis.fetch) => ImageModelV3, input: ImageModelV3CallOptions) {
  let request: { url: string; body: any } | undefined
  const fetch: typeof globalThis.fetch = async (url, init) => {
    request = { url: String(url), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body }
    return new Response(JSON.stringify({ error: { message: 'expected boundary rejection' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    })
  }
  await Promise.resolve(factory(fetch).doGenerate(input)).catch(() => undefined)
  if (!request) throw new Error('No request was sent')
  return request
}
describe('official image protocol boundaries', () => {
  it('sends user-defined OpenAI values without an SDK enum whitelist', async () => {
    const result = await capture(
      (fetch) => createOpenAI({ apiKey: 'test', fetch }).image('custom-image-model'),
      options({
        size: '6144x2048',
        providerOptions: buildVendorProviderOptions(
          'openai',
          { quality: 'custom-quality', outputFormat: 'avif' },
          WIRE_REGISTRY.openai
        )
      })
    )
    expect(result.body).toMatchObject({ size: '6144x2048', quality: 'custom-quality', output_format: 'avif' })
  })
  it('sends user-defined Grok and Gemini native tiers unchanged', async () => {
    const grok = await capture(
      (fetch) => createXai({ apiKey: 'test', fetch }).image('grok-imagine-image-2.0'),
      options({
        aspectRatio: '3:7',
        providerOptions: buildVendorProviderOptions(
          'xai',
          { resolution: '8k', quality: 'custom-quality' },
          WIRE_REGISTRY.xai
        )
      })
    )
    expect(grok.body).toMatchObject({ resolution: '8k', quality: 'custom-quality', aspect_ratio: '3:7' })
    const gemini = await capture(
      (fetch) => createGoogleGenerativeAI({ apiKey: 'test', fetch }).image('gemini-3.1-flash-image-preview'),
      options({
        aspectRatio: '3:7',
        providerOptions: buildVendorProviderOptions(
          'google',
          { imageResolution: '6K', aspectRatio: '3:7' },
          WIRE_REGISTRY.google
        )
      })
    )
    expect(gemini.body.generationConfig.imageConfig).toMatchObject({ imageSize: '6K', aspectRatio: '3:7' })
  })
  it('routes DMXAPI Nano Banana reference-image edits through its Gemini native adapter', async () => {
    const request = await capture(
      (fetch) =>
        createDmxapiProvider({ apiKey: 'test', baseURL: 'https://www.dmxapi.cn/v1', fetch }).imageModel(
          'gemini-3.1-flash-image-ssvip'
        ),
      options({
        files: [{ type: 'file', mediaType: 'image/png', data: 'AAAA' }],
        aspectRatio: '16:9',
        providerOptions: buildVendorProviderOptions(
          'dmxapi',
          { imageResolution: '2K', aspectRatio: '16:9' },
          WIRE_REGISTRY.dmxapi
        )
      })
    )
    expect(request.url).toContain('/v1beta/models/gemini-3.1-flash-image-ssvip:generateContent')
    expect(request.body.generationConfig.imageConfig).toMatchObject({ imageSize: '2K', aspectRatio: '16:9' })
    expect(JSON.stringify(request.body.contents)).toContain('AAAA')
  })
  it('sends OpenAI format and pixel size through the standard Images API', async () => {
    const params = { size: '2048x1152', quality: 'high', outputFormat: 'webp', outputCompression: 90 }
    const result = await capture(
      (fetch) => createOpenAI({ apiKey: 'test', fetch }).image('gpt-image-2'),
      options({
        size: '2048x1152',
        providerOptions: buildVendorProviderOptions('openai', params, WIRE_REGISTRY.openai)
      })
    )
    expect(result.url).toBe('https://api.openai.com/v1/images/generations')
    expect(result.body).toMatchObject({
      model: 'gpt-image-2',
      size: '2048x1152',
      quality: 'high',
      output_format: 'webp',
      output_compression: 90
    })
    expect(result.body).not.toHaveProperty('imageResolution')
  })
  it('sends patched GPT Image 2.5 maximum quality to the HTTP boundary', async () => {
    const result = await capture(
      (fetch) => createOpenAI({ apiKey: 'test', fetch }).image('gpt-image-2.5-sunburst'),
      options({ providerOptions: buildVendorProviderOptions('openai', { quality: 'max' }, WIRE_REGISTRY.openai) })
    )
    expect(result.body.quality).toBe('max')
  })
  it('sends Grok native resolution, ratio and quality for edits', async () => {
    const params = { resolution: '2k', quality: 'medium' }
    const result = await capture(
      (fetch) => createXai({ apiKey: 'test', fetch }).image('grok-imagine-image-2.0'),
      options({
        aspectRatio: '16:9',
        files: [{ type: 'file', mediaType: 'image/png', data: 'AAAA' }],
        providerOptions: buildVendorProviderOptions('xai', params, WIRE_REGISTRY.xai)
      })
    )
    expect(result.url).toBe('https://api.x.ai/v1/images/edits')
    expect(result.body).toMatchObject({
      resolution: '2k',
      aspect_ratio: '16:9',
      quality: 'medium',
      image: { url: 'data:image/png;base64,AAAA' }
    })
  })
  it('uses Google native image configuration and reference input without rewriting a gateway URL', async () => {
    const params = { aspectRatio: '16:9', imageResolution: '2K' }
    const result = await capture(
      (fetch) => createGoogleGenerativeAI({ apiKey: 'test', fetch }).image('gemini-3.1-flash-image-preview'),
      options({
        aspectRatio: '16:9',
        files: [{ type: 'file', mediaType: 'image/png', data: 'AAAA' }],
        providerOptions: buildVendorProviderOptions('google', params, WIRE_REGISTRY.google)
      })
    )
    expect(result.url).toContain(
      'generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent'
    )
    expect(result.body.generationConfig.imageConfig).toMatchObject({ aspectRatio: '16:9', imageSize: '2K' })
    expect(JSON.stringify(result.body.contents)).toContain('AAAA')
  })
})
