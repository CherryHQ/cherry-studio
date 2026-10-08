import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it } from 'vitest'

import { resolveProviderOptionsKey } from '../../../endpoint'
import { buildImageRequest, buildVendorProviderOptions } from '../../wire/buildImageRequest'
import { WIRE_REGISTRY } from '../../wire/wireProfile'
import { captureWithFetch } from './captureRequest'

describe('protocol-specific automatic image options', () => {
  it('preserves auto explicitly emitted by a terminal rule in a nested contribution', () => {
    const result = buildImageRequest(
      { quality: 'auto' },
      {
        fields: { quality: { contribute: (value) => ({ configuration: { quality: String(value) } }) } }
      }
    )
    expect(result).toEqual({ configuration: { quality: 'auto' } })
  })

  // https://developers.openai.com/api/reference/resources/images; retrieved 2026-10-08.
  it('delivers auto quality, background and moderation to the real SDK HTTP body', async () => {
    const params = { quality: 'auto', background: 'auto', moderation: 'auto' }
    const req = await captureWithFetch((fetch) =>
      createOpenAI({ apiKey: 'test', fetch })
        .image('gpt-image-1')
        .doGenerate({
          prompt: 'a fox',
          n: 1,
          size: undefined,
          aspectRatio: undefined,
          seed: undefined,
          files: undefined,
          mask: undefined,
          abortSignal: undefined,
          headers: undefined,
          providerOptions: buildVendorProviderOptions(
            resolveProviderOptionsKey('openai'),
            params,
            WIRE_REGISTRY.openai,
            params
          )
        })
    )
    expect(req.body).toMatchObject({ quality: 'auto', background: 'auto', moderation: 'auto' })
  })

  // https://ai.google.dev/api/generate-content#ImageConfig; retrieved 2026-10-08.
  it.each([
    { params: { aspectRatio: 'auto', imageResolution: 'auto' }, imageConfig: undefined },
    { params: { aspectRatio: 'auto', imageResolution: '2K' }, imageConfig: { imageSize: '2K' } },
    { params: { aspectRatio: '16:9', imageResolution: 'auto' }, imageConfig: { aspectRatio: '16:9' } }
  ] as const)(
    'omits only Google automatic dimensions, preserving explicit dimensions: $params',
    async ({ params, imageConfig }) => {
      const req = await captureWithFetch((fetch) =>
        createGoogleGenerativeAI({ apiKey: 'test', fetch })
          .image('gemini-3.1-flash-image')
          .doGenerate({
            prompt: 'a fox',
            n: 1,
            size: undefined,
            aspectRatio: undefined,
            seed: undefined,
            files: undefined,
            mask: undefined,
            abortSignal: undefined,
            headers: undefined,
            providerOptions: buildVendorProviderOptions(
              resolveProviderOptionsKey('google'),
              params,
              WIRE_REGISTRY.google,
              params
            )
          })
      )
      expect(req.body).toHaveProperty('generationConfig')
      if (imageConfig === undefined) {
        expect(req.body).not.toHaveProperty('generationConfig.imageConfig')
      } else {
        expect(req.body).toHaveProperty('generationConfig.imageConfig', imageConfig)
      }
    }
  )
})
