import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { createAihubmixImageModel } from '../../aihubmix/aihubmixImageModel'
import { captureWithFetch } from './captureRequest'

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

/**
 * AiHubMix image-model boundary — the bespoke branches (NOT the gpt-image /
 * dall-e OpenAI-compat delegate or the Google delegate, which forward to AI SDK
 * adapters covered elsewhere).
 *
 * ORACLE: https://docs.aihubmix.com/cn/api/IdeogramAI (retrieved 2026-07-26).
 * Read that before changing an expectation here. These assertions are only worth
 * anything if their expected values come from the vendor's spec — an expectation
 * read off the implementation makes the test agree with whatever the code does,
 * including a bug. This file did exactly that: it pinned
 * `/ideogram/aihubmix_image_generate`, a v1 config key spliced into a URL, which
 * 404s. Per the doc the V1/V2 endpoints are `/ideogram/{generate,remix,upscale}`
 * and V3 is `/ideogram/v1/ideogram-v3/{generate,remix}`; the reference image is
 * `image` (V3, multipart) and `image_file` (V1/V2, alongside an `image_request`
 * JSON part).
 *
 * What this file CAN do: tell you the wire changed. What it CANNOT do: tell you
 * the wire is right — only the doc above does that.
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

const config = {
  baseURL: 'https://aihubmix.com/v1',
  resolveApiKey: () => 'sk',
  headers: () => ({ Authorization: 'Bearer sk' })
}

describe('AiHubMix image-model boundary (Ideogram branches)', () => {
  it('V_3 generate → FormData to /ideogram/v1/ideogram-v3/generate', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmixImageModel('V_3', { ...config, fetch }).doGenerate(
        opts({
          n: 2,
          aspectRatio: '16:9',
          providerOptions: {
            aihubmix: {
              mode: 'generate',
              renderingSpeed: 'TURBO',
              styleType: 'GENERAL',
              seed: '42',
              negativePrompt: 'blur',
              magicPromptOption: true
            }
          }
        })
      )
    )
    expect(req.url).toBe('https://aihubmix.com/ideogram/v1/ideogram-v3/generate')
    // FormData → flat record of string fields
    z.strictObject({
      prompt: z.string(),
      rendering_speed: z.string(),
      num_images: z.string(),
      aspect_ratio: z.string(),
      style_type: z.string(),
      seed: z.string(),
      negative_prompt: z.string(),
      magic_prompt: z.string()
    }).parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('V_2 generate → { image_request } JSON to /ideogram/generate', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmixImageModel('V_2', { ...config, fetch }).doGenerate(
        opts({
          n: 3,
          aspectRatio: '1:1',
          providerOptions: {
            aihubmix: {
              styleType: 'REALISTIC',
              seed: 7,
              negativePrompt: 'noise',
              magicPromptOption: false
            }
          }
        })
      )
    )
    // Per docs.aihubmix.com "V2-V1 接口说明": `POST https://aihubmix.com/ideogram/generate`.
    // This asserted `/ideogram/aihubmix_image_generate` — the v1 CONFIG key spliced into
    // the path — so the test agreed with a URL that 404s.
    expect(req.url).toBe('https://aihubmix.com/ideogram/generate')
    z.strictObject({
      image_request: z.strictObject({
        prompt: z.string(),
        model: z.string(),
        aspect_ratio: z.string(),
        num_images: z.number().int().positive(),
        style_type: z.string(),
        seed: z.number().int(),
        negative_prompt: z.string(),
        magic_prompt_option: z.string()
      })
    }).parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('doubao-seedream → JSON to /v1/images/generations with response_format + sequential', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmixImageModel('doubao-seedream-5.0-lite', { ...config, fetch }).doGenerate(
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
