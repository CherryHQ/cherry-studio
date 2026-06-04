import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { createAihubmixImageModel } from '../../aihubmix/aihubmixImageModel'
import { captureWithFetch } from './captureRequest'

vi.mock('@renderer/i18n', () => ({ default: { t: (k: string) => k } }))
vi.mock('i18next', () => ({ default: { t: (k: string) => k } }))

/**
 * AiHubMix image-model boundary — the bespoke Ideogram branches (NOT the
 * OpenAI-compat / Google delegates, which forward to AI SDK adapters covered
 * elsewhere). V_3 posts FormData to `/ideogram/v1/ideogram-v3/*`; V_1/V_2 post
 * an `{ image_request }` JSON to `/ideogram/aihubmix_image_*`. numImages comes
 * from `options.n`, aspectRatio from `options.aspectRatio`.
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

  it('V_2 generate → { image_request } JSON to /ideogram/aihubmix_image_generate', async () => {
    const req = await captureWithFetch((fetch) =>
      createAihubmixImageModel('V_2', { ...config, fetch }).doGenerate(
        opts({
          n: 3,
          aspectRatio: '1:1',
          providerOptions: {
            aihubmix: {
              mode: 'generate',
              styleType: 'REALISTIC',
              seed: '7',
              negativePrompt: 'noise',
              magicPromptOption: false
            }
          }
        })
      )
    )
    expect(req.url).toBe('https://aihubmix.com/ideogram/aihubmix_image_generate')
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
})
