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
  it.each([
    { data: [{ url: 'https://img/ok.png' }, {}] },
    { data: [{ url: 'https://img/ok.png' }, { is_image_safe: true }] },
    { data: [{ url: 'https://img/ok.png' }, { is_image_safe: 'false' }] },
    { data: [{ url: 'https://img/ok.png' }, { url: 42 }] },
    { output: { b64_json: [{ bytesBase64: 'AQID' }] } }
  ])('rejects malformed Ideogram results rather than silently filtering them: %j', async (response) => {
    await expect(
      runWithResponse(response, (fetch) =>
        createAihubmixImageModel('ideogram/V3', {
          ...config,
          fetch,
          binding: { kind: 'ideogram-v3', operation: 'generate' }
        }).doGenerate(opts({}))
      )
    ).rejects.toThrow()
  })

  it.each([{}, { data: [] }, { data: [{ url: 'https://img/ok.png' }, {}] }, { data: [{ b64_json: 42 }] }])(
    'rejects malformed Doubao image results: %j',
    async (response) => {
      await expect(
        runWithResponse(response, (fetch) =>
          createAihubmixImageModel('doubao-seedream-5.0-lite', {
            ...config,
            fetch,
            binding: { kind: 'doubao' }
          }).doGenerate(opts({}))
        )
      ).rejects.toThrow()
    }
  )

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

  // https://developer.ideogram.ai/api-reference/generate-images/generate-v3 — retrieved 2026-09-09.
  it('omits explicitly moderated Ideogram images, without treating arbitrary missing URLs as moderation', async () => {
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
