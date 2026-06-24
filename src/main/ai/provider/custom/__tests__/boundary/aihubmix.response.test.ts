import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { createAihubmixImageModel } from '../../aihubmix/aihubmixImageModel'
import { runWithResponse } from './captureRequest'

vi.mock('@renderer/i18n', () => ({ default: { t: (k: string) => k } }))
vi.mock('i18next', () => ({ default: { t: (k: string) => k } }))

/**
 * Inbound (response) boundary for the AiHubMix Ideogram branches: V_3 generate
 * parses `data[].url`; the V_1/V_2 shared path also accepts the wrapped
 * `output.b64_json[].bytesBase64` form (→ data: URLs).
 */
function opts(partial: Partial<ImageModelV3CallOptions>): ImageModelV3CallOptions {
  return {
    prompt: 'a fox',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    providerOptions: { aihubmix: { mode: 'generate' } },
    headers: undefined,
    abortSignal: undefined,
    files: undefined,
    mask: undefined,
    ...partial
  } as ImageModelV3CallOptions
}

const config = {
  baseURL: 'https://aihubmix.com/v1',
  resolveApiKey: () => 'sk',
  headers: () => ({ Authorization: 'Bearer sk' })
}

describe('AiHubMix response boundary (Ideogram branches)', () => {
  it('V_3 generate → data[].url', async () => {
    const response = { data: [{ url: 'https://img/v3a.png' }, { url: 'https://img/v3b.png' }] }
    z.object({ data: z.array(z.object({ url: z.string() })) }).parse(response)
    const result = await runWithResponse(response, (fetch) =>
      createAihubmixImageModel('V_3', { ...config, fetch }).doGenerate(opts({}))
    )
    expect(result.images).toMatchSnapshot()
  })

  it('V_3 generate → drops data[] items that carry no usable url', async () => {
    // AiHubMix is an aggregator gateway and Ideogram can flag an image
    // (`is_image_safe: false`), so a `data[]` entry may arrive without a `url`.
    // The V_1/V_2 path in this same file already filters those out; the V_3
    // branch must too, otherwise `undefined` leaks into `images`.
    const response = { data: [{ url: 'https://img/ok.png' }, { is_image_safe: false, resolution: '1024x1024' }] }
    const result = await runWithResponse(response, (fetch) =>
      createAihubmixImageModel('V_3', { ...config, fetch }).doGenerate(opts({}))
    )
    expect(result.images).toEqual(['https://img/ok.png'])
  })

  it('V_2 generate → output.b64_json[].bytesBase64 (wrapped → data: URLs)', async () => {
    const response = { output: { b64_json: [{ bytesBase64: 'QUJD' }] } }
    z.object({ output: z.object({ b64_json: z.array(z.object({ bytesBase64: z.string() })) }) }).parse(response)
    const result = await runWithResponse(response, (fetch) =>
      createAihubmixImageModel('V_2', { ...config, fetch }).doGenerate(opts({}))
    )
    expect(result.images).toMatchSnapshot()
  })
})
