import { describe, expect, it } from 'vitest'

import { buildVideoProviderOptions, type VideoOptionParams } from '../videoOptions'

describe('buildVideoProviderOptions', () => {
  it('maps negativePrompt + personGeneration to GoogleVideoModelOptions (lowercased enum)', () => {
    const result = buildVideoProviderOptions('google', {
      negativePrompt: 'blurry, low quality',
      personGeneration: 'ALLOW_ADULT'
    } satisfies VideoOptionParams)

    expect(result).toEqual({
      google: {
        negativePrompt: 'blurry, low quality',
        personGeneration: 'allow_adult'
      }
    })
  })

  it('forwards the registry vendor bag for google, then overlays mapped canonical fields, skipping callbacks', () => {
    const onProgress = () => {}
    const result = buildVideoProviderOptions('google', {
      negativePrompt: 'no text',
      providerOptions: { google: { pollTimeoutMs: 600000, onProgress } }
    })

    expect(result).toEqual({
      google: {
        pollTimeoutMs: 600000,
        negativePrompt: 'no text'
      }
    })
    expect((result.google as Record<string, unknown>).onProgress).toBeUndefined()
  })

  it("drops the 'auto' sentinel and empty values", () => {
    const result = buildVideoProviderOptions('google', {
      negativePrompt: '',
      personGeneration: 'auto'
    })
    expect(result).toEqual({})
  })

  it('falls back to snake_case negative_prompt under the provider id for non-google providers', () => {
    const result = buildVideoProviderOptions('replicate', {
      negativePrompt: 'no watermark',
      providerOptions: { replicate: { motionStrength: 0.8 } }
    })

    expect(result).toEqual({
      replicate: {
        motionStrength: 0.8,
        negative_prompt: 'no watermark'
      }
    })
  })

  it('returns an empty object when there is nothing to map', () => {
    expect(buildVideoProviderOptions('google', {})).toEqual({})
    expect(buildVideoProviderOptions('replicate', {})).toEqual({})
  })
})
