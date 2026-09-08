import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { createAihubmixImageModel } from '../../aihubmix/aihubmixImageModel'
import { runWithResponse } from './captureRequest'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

// Contracts: https://docs.aihubmix.com/cn/api/Image-Gen and https://docs.aihubmix.com/cn/api/IdeogramAI.
// Retrieved 2026-09-09; only documented result shapes are contract fixtures.
function opts(partial: Partial<ImageModelV3CallOptions>): ImageModelV3CallOptions {
  return {
    prompt: 'a fox',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    providerOptions: { aihubmix: {} },
    headers: undefined,
    abortSignal: undefined,
    files: undefined,
    mask: undefined,
    ...partial
  }
}

const config = {
  baseURL: 'https://aihubmix.com/v1',
  resolveApiKey: () => 'sk',
  headers: () => ({ Authorization: 'Bearer sk' })
}

describe('AiHubMix response boundary (Ideogram branches)', () => {
  it('ideogram/V3 generate → data[].url', async () => {
    const response = { data: [{ url: 'https://img/v3a.png' }, { url: 'https://img/v3b.png' }] }
    const result = await runWithResponse(response, (fetch) =>
      createAihubmixImageModel('ideogram/V3', {
        ...config,
        fetch,
        binding: { kind: 'ideogram-v3', operation: 'generate' }
      }).doGenerate(opts({}))
    )
    expect(result.images).toEqual(['https://img/v3a.png', 'https://img/v3b.png'])
  })

  it('ideogram/V3 generate → drops data[] items that carry no usable url', async () => {
    // AiHubMix is an aggregator gateway and Ideogram can flag an image
    // (`is_image_safe: false`), so a `data[]` entry may arrive without a `url`.
    // The V_1/V_2 path in this same file already filters those out; the V3
    // branch must too, otherwise `undefined` leaks into `images`.
    const response = { data: [{ url: 'https://img/ok.png' }, { is_image_safe: false, resolution: '1024x1024' }] }
    const result = await runWithResponse(response, (fetch) =>
      createAihubmixImageModel('ideogram/V3', {
        ...config,
        fetch,
        binding: { kind: 'ideogram-v3', operation: 'generate' }
      }).doGenerate(opts({}))
    )
    expect(result.images).toEqual(['https://img/ok.png'])
  })

  it('doubao-seedream → mixed data[].url + data[].b64_json (→ data: URLs)', async () => {
    const response = { data: [{ url: 'https://img/d1.png' }, { b64_json: 'QUJD' }] }
    const result = await runWithResponse(response, (fetch) =>
      createAihubmixImageModel('doubao-seedream-5.0-lite', {
        ...config,
        fetch,
        binding: { kind: 'doubao' }
      }).doGenerate(opts({}))
    )
    expect(result.images).toEqual(['https://img/d1.png', 'data:image/png;base64,QUJD'])
  })
})
