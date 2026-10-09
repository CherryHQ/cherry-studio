import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { createAihubmixImageModel } from '../../aihubmix/aihubmixImageModel'
import { captureWithFetch } from './captureRequest'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

// Ideogram request fields: https://docs.aihubmix.com/cn/api/IdeogramAI — retrieved 2026-10-08.
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
  }
}

const config = {
  baseURL: 'https://aihubmix.com/v1',
  resolveApiKey: () => 'sk',
  headers: () => ({ Authorization: 'Bearer sk' })
}

describe('AiHubMix image-model boundary (Ideogram branches)', () => {
  it('ideogram/V3 generate → FormData to /ideogram/v1/ideogram-v3/generate', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmixImageModel('ideogram/V3', {
        ...config,
        fetch,
        binding: { kind: 'ideogram-v3', operation: 'generate' }
      }).doGenerate(
        opts({
          n: 2,
          aspectRatio: '16:9',
          seed: 0,
          providerOptions: {
            aihubmix: {
              renderingSpeed: 'TURBO',
              styleType: 'GENERAL',
              negativePrompt: 'blur',
              magicPromptOption: true
            }
          }
        })
      )
    )
    expect(req.url).toBe('https://aihubmix.com/ideogram/v1/ideogram-v3/generate')
    expect(req.body).toEqual({
      prompt: 'a fox',
      rendering_speed: 'TURBO',
      num_images: '2',
      aspect_ratio: '16x9',
      style_type: 'GENERAL',
      seed: '0',
      negative_prompt: 'blur',
      magic_prompt: 'ON'
    })
  })

  // V1 has no style_type: https://developer.ideogram.ai/v1/api-reference/legacy-endpoints/generate — retrieved 2026-10-08.
  it('V_1 encodes a canonical ratio without requiring V2-only options', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmixImageModel('V_1', {
        ...config,
        fetch,
        binding: { kind: 'ideogram-v1-v2', operation: 'generate' }
      }).doGenerate(opts({ aspectRatio: '16:9' }))
    )
    expect(req.body).toMatchObject({ image_request: { model: 'V_1', aspect_ratio: 'ASPECT_16_9' } })
    expect(req.body).not.toHaveProperty('image_request.style_type')
  })

  it('V_2 encodes the canonical ratio alongside its supported options', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmixImageModel('V_2', {
        ...config,
        fetch,
        binding: { kind: 'ideogram-v1-v2', operation: 'generate' }
      }).doGenerate(
        opts({
          n: 3,
          aspectRatio: '16:9',
          seed: 0,
          providerOptions: {
            aihubmix: {
              styleType: 'REALISTIC',
              negativePrompt: 'noise',
              magicPromptOption: false
            }
          }
        })
      )
    )
    expect(req.url).toBe('https://aihubmix.com/ideogram/generate')
    expect(req.body).toEqual({
      image_request: {
        prompt: 'a fox',
        model: 'V_2',
        aspect_ratio: 'ASPECT_16_9',
        num_images: 3,
        style_type: 'REALISTIC',
        seed: 0,
        negative_prompt: 'noise',
        magic_prompt_option: 'OFF'
      }
    })
  })

  it('doubao-seedream → JSON to /v1/images/generations with response_format + sequential', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmixImageModel('doubao-seedream-5.0-lite', {
        ...config,
        fetch,
        binding: { kind: 'doubao' }
      }).doGenerate(
        opts({
          n: 3,
          seed: 42,
          providerOptions: {
            aihubmix: {
              imageResolution: '2K',
              addWatermark: false,
              sequentialImageGeneration: 'auto',
              maxImages: 4
            }
          }
        })
      )
    )
    expect(req.url).toBe('https://aihubmix.com/v1/images/generations')
    // Explicit response_format (the inner model would force b64_json) + the
    // snake_case sequential block; size from the forwarded `imageResolution` bag.
    expect(req.body).toEqual({
      model: 'doubao-seedream-5.0-lite',
      prompt: 'a fox',
      response_format: 'url',
      size: '2K',
      n: 3,
      seed: 42,
      watermark: false,
      sequential_image_generation: 'auto',
      sequential_image_generation_options: { max_images: 4 }
    })
  })
})

// Google ImageConfig: https://ai.google.dev/api/generate-content#ImageConfig — retrieved 2026-10-08.
it('does not infer an AiHubMix Google ratio from the size field', async () => {
  const req = await captureWithFetch((fetch) =>
    createAihubmixImageModel('gemini-3-pro-image-preview', {
      ...config,
      fetch,
      binding: { kind: 'google-gemini' }
    }).doGenerate(
      opts({
        // @ts-expect-error The app's size bag may contain a ratio-looking string; it must not become a ratio.
        size: '16:9',
        providerOptions: { aihubmix: { imageResolution: '2K' } }
      })
    )
  )
  expect(req.body).toMatchObject({ generationConfig: { imageConfig: { imageSize: '2K' } } })
  expect(req.body).not.toHaveProperty('generationConfig.imageConfig.aspectRatio')
})
