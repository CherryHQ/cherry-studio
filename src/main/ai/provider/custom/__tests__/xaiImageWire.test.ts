import { join } from 'node:path'

import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { createXai } from '@ai-sdk/xai'
import { describe, expect, it } from 'vitest'

import { buildParamsSchema, type ImageGenerationMode } from '@cherrystudio/provider-registry'
import { readProviderModelRegistry } from '@cherrystudio/provider-registry/node'

import { splitParamValues } from '../../../utils/imageOptions'
import { buildVendorProviderOptions } from '../wire/buildImageRequest'
import { DEFAULT_DIFFUSION_REGISTRATION, WIRE_REGISTRY } from '../wire/wireProfile'

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='
const BASE_URL = 'https://api.x.ai/v1'
const { overrides } = readProviderModelRegistry(
  join(process.cwd(), 'packages/provider-registry/data/provider-models.json')
)

function paramsSchema(modelId: string, mode: ImageGenerationMode) {
  const support = overrides.find((row) => row.providerId === 'grok' && row.modelId === modelId)?.imageGeneration
  expect(support, `${modelId} imageGeneration declaration`).toBeDefined()
  expect(support?.modes[mode]?.supports.aspectRatio, `${modelId} ${mode} aspectRatio declaration`).toMatchObject({
    type: 'enum'
  })
  return buildParamsSchema(support, mode)
}

async function captureRequest(
  mode: ImageGenerationMode,
  parsed: Record<string, unknown>,
  files?: ImageModelV3CallOptions['files']
) {
  const requests: { url: string; contentType: string | null; body: Record<string, unknown> }[] = []
  const fetch: typeof globalThis.fetch = (url, init) => {
    expect(String(url)).toBe(`${BASE_URL}/images/${mode === 'edit' ? 'edits' : 'generations'}`)
    expect(init?.method).toBe('POST')
    const contentType = new Headers(init?.headers).get('Content-Type')
    expect(contentType).toBe('application/json')
    expect(typeof init?.body).toBe('string')
    requests.push({ url: String(url), contentType, body: JSON.parse(String(init?.body)) })
    return Promise.resolve(
      new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  }
  const { structured, vendorBag } = splitParamValues(parsed)
  const registration = WIRE_REGISTRY['xai'] ?? DEFAULT_DIFFUSION_REGISTRATION
  const providerOptions = buildVendorProviderOptions('xai', parsed, registration, vendorBag)
  const result = await createXai({ apiKey: 'test', baseURL: BASE_URL, fetch })
    .image('grok-imagine-image-2.0')
    .doGenerate({
      prompt: 'a fox',
      n: 1,
      size: structured.size as ImageModelV3CallOptions['size'],
      aspectRatio: structured.aspectRatio as ImageModelV3CallOptions['aspectRatio'],
      seed: structured.seed,
      providerOptions,
      files,
      mask: undefined
    })
  expect(result.images).toEqual([PNG_BASE64])
  expect(requests).toHaveLength(1)
  return requests[0]
}

describe('xAI image catalog to HTTP body boundary', () => {
  it('T1: sends the catalog-accepted generate aspect ratio without size', async () => {
    const parsed = paramsSchema('grok-imagine-image-2-0', 'generate').parse({ aspectRatio: '3:4' })
    expect(parsed.aspectRatio).toBe('3:4')

    const req = await captureRequest('generate', parsed)
    expect(req.url).toBe('https://api.x.ai/v1/images/generations')
    expect(req.contentType).toBe('application/json')
    expect(req.body).toEqual({
      model: 'grok-imagine-image-2.0',
      prompt: 'a fox',
      n: 1,
      response_format: 'b64_json',
      aspect_ratio: '3:4'
    })
    expect(req.body).not.toHaveProperty('size')
  })

  it('T2: sends the catalog-accepted edit aspect ratio and reference image as JSON', async () => {
    const parsed = paramsSchema('grok-imagine-image-2-0', 'edit').parse({ aspectRatio: '9:16' })
    expect(parsed.aspectRatio).toBe('9:16')

    const req = await captureRequest('edit', parsed, [
      { type: 'file', mediaType: 'image/png', data: new Uint8Array(Buffer.from(PNG_BASE64, 'base64')) }
    ])
    expect(req.url).toBe('https://api.x.ai/v1/images/edits')
    expect(req.contentType).toBe('application/json')
    expect(req.body).toEqual({
      model: 'grok-imagine-image-2.0',
      prompt: 'a fox',
      n: 1,
      response_format: 'b64_json',
      aspect_ratio: '9:16',
      image: { url: `data:image/png;base64,${PNG_BASE64}`, type: 'image_url' }
    })
  })

  it('T3: omits the aspect_ratio key for the catalog-accepted auto value', async () => {
    const parsed = paramsSchema('grok-imagine-image-2-0', 'generate').parse({ aspectRatio: 'auto' })
    expect(parsed.aspectRatio).toBe('auto')

    const req = await captureRequest('generate', parsed)
    expect(Object.prototype.hasOwnProperty.call(req.body, 'aspect_ratio')).toBe(false)
    expect(req.body).toEqual({
      model: 'grok-imagine-image-2.0',
      prompt: 'a fox',
      n: 1,
      response_format: 'b64_json'
    })
  })

  it('T4: sends 21:9 for Image 2.0 and rejects that field for Image Quality', async () => {
    const parsed = paramsSchema('grok-imagine-image-2-0', 'generate').parse({ aspectRatio: '21:9' })
    expect(parsed.aspectRatio).toBe('21:9')

    const req = await captureRequest('generate', parsed)
    expect(req.body).toEqual({
      model: 'grok-imagine-image-2.0',
      prompt: 'a fox',
      n: 1,
      response_format: 'b64_json',
      aspect_ratio: '21:9'
    })

    // Invalid field values are dropped by buildParamsSchema's catch(undefined).
    const qualityParsed = paramsSchema('grok-imagine-image-quality', 'generate').parse({ aspectRatio: '21:9' })
    expect(qualityParsed.aspectRatio).toBeUndefined()
  })
})
