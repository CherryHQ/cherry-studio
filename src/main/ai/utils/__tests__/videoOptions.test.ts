import { describe, expect, it } from 'vitest'

import { buildVideoProviderOptions, splitVideoParamValues } from '../videoOptions'

describe('splitVideoParamValues', () => {
  it('partitions native AI SDK scalars from the vendor long tail', () => {
    const { native, vendor } = splitVideoParamValues({
      duration: 5,
      aspectRatio: '16:9',
      resolution: '1280x720',
      fps: 24,
      seed: 7,
      negativePrompt: 'blurry',
      cameraFixed: true,
      cfg: 7.5
    })
    expect(native).toEqual({ duration: 5, aspectRatio: '16:9', resolution: '1280x720', fps: 24, seed: 7 })
    expect(vendor).toEqual({ negativePrompt: 'blurry', cameraFixed: true, cfg: 7.5 })
  })

  it("drops blank / 'auto' sentinel values (server applies its own default)", () => {
    const { native, vendor } = splitVideoParamValues({
      resolution: 'auto',
      negativePrompt: '',
      movementAmplitude: 'auto',
      seed: undefined
    })
    expect(native).toEqual({})
    expect(vendor).toEqual({})
  })

  it('normalizes the form ASPECT_X_Y enum once', () => {
    expect(splitVideoParamValues({ aspectRatio: 'ASPECT_16_9' }).native.aspectRatio).toBe('16:9')
    expect(splitVideoParamValues({ aspectRatio: 'not-a-ratio' }).native.aspectRatio).toBeUndefined()
  })
})

describe('buildVideoProviderOptions', () => {
  const split = (paramValues: Parameters<typeof splitVideoParamValues>[0]) => splitVideoParamValues(paramValues)

  it('google: maps negativePrompt + lowercases personGeneration; native scalars stay top-level', () => {
    const options = buildVideoProviderOptions(
      'google',
      split({ duration: 5, negativePrompt: 'blurry', personGeneration: 'ALLOW_ADULT' })
    )
    expect(options).toEqual({ google: { negativePrompt: 'blurry', personGeneration: 'allow_adult' } })
  })

  it('dmxapi: maps native scalars into the bag under CANONICAL names (buildSubmitBody renames)', () => {
    const options = buildVideoProviderOptions(
      'dmxapi',
      split({ duration: 5, aspectRatio: '16:9', resolution: '720p', seed: 7, movementAmplitude: 'small' })
    )
    expect(options).toEqual({
      dmxapi: { resolution: '720p', aspectRatio: '16:9', duration: 5, seed: 7, movementAmplitude: 'small' }
    })
  })

  it('ppio: snake_case wire fields with string duration', () => {
    const options = buildVideoProviderOptions(
      'ppio',
      split({ duration: 5, aspectRatio: '16:9', resolution: '720p', seed: 7, negativePrompt: 'low', cameraFixed: true })
    )
    expect(options).toEqual({
      ppio: {
        resolution: '720p',
        aspect_ratio: '16:9',
        duration: '5',
        seed: 7,
        negative_prompt: 'low',
        camera_fixed: true
      }
    })
  })

  it('aihubmix: Sora-compatible seconds (string) + size', () => {
    const options = buildVideoProviderOptions('aihubmix', split({ duration: 10, resolution: '1280x720' }))
    expect(options).toEqual({ aihubmix: { seconds: '10', size: '1280x720' } })
  })

  it('fallback: forwards the canonical long tail + snake_case negative_prompt', () => {
    const options = buildVideoProviderOptions('replicate', split({ negativePrompt: 'low', watermark: false }))
    expect(options).toEqual({ replicate: { watermark: false, negative_prompt: 'low' } })
  })

  it('returns {} when nothing maps (no empty provider key)', () => {
    expect(buildVideoProviderOptions('google', split({ duration: 5 }))).toEqual({})
  })
})
