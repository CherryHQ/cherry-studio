import { createByteDance } from '@ai-sdk/bytedance'
import { OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { resolveProviderOptionsKey } from '../../../endpoint'
import { buildVendorProviderOptions } from '../../wire/buildImageRequest'
import { WIRE_REGISTRY } from '../../wire/wireProfile'
import { captureWithFetch, runWithResponse } from './captureRequest'

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

const file = (byte: number): NonNullable<ImageModelV3CallOptions['files']>[number] =>
  ({ mediaType: 'image/png', data: new Uint8Array([byte]) }) as NonNullable<ImageModelV3CallOptions['files']>[number]

/** What `AiService.generateImage` delivers for a canonical param bag — under
 *  `sdkConfig.optionsKey`, exactly as the service computes it. */
const deliver = (paramValues: Record<string, unknown>) =>
  buildVendorProviderOptions(resolveProviderOptionsKey('doubao'), paramValues, WIRE_REGISTRY.doubao, paramValues)

describe('Doubao (Ark) image boundary', () => {
  it('delivers the vendor body under `bytedance`, the key the package reads', () => {
    // Not `doubao` (our provider id) and not `openai-compatible` (the pre-fix id, under
    // which every control below was silently dropped) — `@ai-sdk/bytedance` reads its
    // own fixed namespace, so the registration re-keys the body.
    expect(deliver({ imageResolution: '2K' })).toEqual({ bytedance: { size: '2K' } })
  })

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
    expect(req.body).toMatchSnapshot()
  })

  /**
   * Regression guard for the `'auto'` trap: `buildImageRequest`'s `skipValue` treats
   * `'auto'` as "unset", but for Ark it is the value that ENABLES group images. It
   * survives only because the registration passes it through rather than wire-mapping it.
   */
  it('keeps sequentialImageGeneration="auto" instead of dropping it as an unset sentinel', () => {
    expect(deliver({ sequentialImageGeneration: 'auto', maxImages: 4 })).toEqual({
      bytedance: { sequentialImageGeneration: 'auto', maxImages: 4 }
    })
  })

  it('one reference image: stays on /images/generations with a bare `image` string', async () => {
    const req = await captureWithFetch((fetch) =>
      imageModel('doubao-seedream-5-0-pro', fetch).doGenerate(opts({ files: [file(1)] }))
    )
    expect(req.url).toBe(url)
    expect(req.body).toMatchObject({ image: 'data:image/png;base64,AQ==' })
  })

  it('several reference images: `image` becomes an array', async () => {
    const req = await captureWithFetch((fetch) =>
      imageModel('doubao-seedream-5-0-lite', fetch).doGenerate(opts({ files: [file(1), file(2)] }))
    )
    expect(req.url).toBe(url)
    expect(req.body).toMatchObject({ image: ['data:image/png;base64,AQ==', 'data:image/png;base64,Ag=='] })
  })

  /**
   * The oracle for why this provider exists: the generic OpenAI-compatible image model
   * switches to a multipart `/images/edits` as soon as `files` is set — an endpoint Ark
   * does not serve. If upstream ever converges on Ark's shape, this test fails and the
   * bespoke provider can be reconsidered.
   */
  it('the generic openai-compatible model would POST multipart /images/edits instead', async () => {
    const req = await captureWithFetch((fetch) =>
      new OpenAICompatibleImageModel('doubao-seedream-5-0-pro', {
        provider: 'openai-compatible.image',
        url: ({ path }) => `${baseURL}${path}`,
        headers: () => ({ Authorization: 'Bearer sk' }),
        fetch
      }).doGenerate(opts({ files: [file(1)] }))
    )
    expect(req.url).toBe(`${baseURL}/images/edits`)
  })

  it('reports the params Ark genuinely does not take rather than sending them', async () => {
    const result = await runWithResponse({ data: [{ b64_json: 'AQID' }] }, (fetch) =>
      imageModel('doubao-seedream-4-0', fetch).doGenerate(
        // `seed` was removed from Ark's image API; aspectRatio/mask were never in it.
        opts({ seed: 7, aspectRatio: '1:1', mask: file(9) as unknown as ImageModelV3CallOptions['mask'] })
      )
    )
    expect(result.images).toEqual(['AQID'])
    expect(result.warnings.map((w) => w.type === 'unsupported' && w.feature)).toEqual(['aspectRatio', 'seed', 'mask'])
  })
})
