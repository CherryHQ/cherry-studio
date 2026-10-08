import { createByteDance } from '@ai-sdk/bytedance'
import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { resolveProviderOptionsKey } from '../../../endpoint'
import { buildVendorProviderOptions } from '../../wire/buildImageRequest'
import { WIRE_REGISTRY } from '../../wire/wireProfile'
import { captureWithFetch } from './captureRequest'

/**
 * Doubao (Volcengine Ark) image boundary — `@ai-sdk/bytedance` on Ark's single
 * `POST /images/generations`, for both text-to-image and reference-image edits.
 *
 * The unit under test is the SEAM: our canonical camelCase param bag → the delivery
 * key + option names that package reads → the Ark wire. The package owns the vendor
 * naming; these tests pin that our mapping actually lands on its options, since a
 * miss there is silent (its option schema is a `looseObject`).
 */
function opts(partial: Partial<ImageModelV3CallOptions>): ImageModelV3CallOptions {
  return {
    prompt: 'a fox',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    providerOptions: {},
    headers: undefined,
    abortSignal: undefined,
    files: undefined,
    mask: undefined,
    ...partial
  } as ImageModelV3CallOptions
}

const baseURL = 'https://ark.cn-beijing.volces.com/api/v3'
const url = `${baseURL}/images/generations`

const imageModel = (modelId: string, fetch: typeof globalThis.fetch) =>
  createByteDance({ apiKey: 'sk', baseURL, fetch }).imageModel(modelId)

/** What `AiService.generateImage` delivers for a canonical param bag — under
 *  `sdkConfig.providerOptionsKey`, exactly as the service computes it. */
const deliver = (paramValues: Record<string, unknown>) =>
  buildVendorProviderOptions(resolveProviderOptionsKey('doubao'), paramValues, WIRE_REGISTRY.doubao, paramValues)

describe('Doubao (Ark) image boundary', () => {
  it('maps the whole canonical bag onto Ark option names', async () => {
    const req = await captureWithFetch((fetch) =>
      imageModel('doubao-seedream-5-0-lite', fetch).doGenerate(
        opts({
          providerOptions: deliver({
            imageResolution: '4K',
            addWatermark: false,
            outputFormat: 'png',
            sequentialImageGeneration: 'auto',
            maxImages: 4
          })
        })
      )
    )
    expect(req.url).toBe(url)
    expect(req.method).toBe('POST')
    z.strictObject({
      model: z.literal('doubao-seedream-5-0-lite'),
      prompt: z.string(),
      size: z.literal('4K'),
      watermark: z.literal(false),
      output_format: z.literal('png'),
      sequential_image_generation: z.literal('auto'),
      sequential_image_generation_options: z.strictObject({ max_images: z.literal(4) }),
      response_format: z.literal('b64_json')
    }).parse(req.body)
  })
})
