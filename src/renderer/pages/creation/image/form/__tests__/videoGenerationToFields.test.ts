import type { VideoGenerationSupport } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { videoGenerationToFields } from '../videoGenerationToFields'

const support: VideoGenerationSupport = {
  modes: {
    t2v: {
      supports: {
        resolution: { type: 'enum', options: ['720p', '1080p'], default: '720p' },
        aspectRatio: { type: 'enum', options: ['16:9', '9:16'], default: '16:9' },
        duration: { type: 'range', min: 4, max: 12, default: 5 },
        seed: { type: 'text' },
        negativePrompt: { type: 'text', multiline: true },
        watermark: { type: 'switch', default: false },
        generateAudio: { type: 'switch', default: true }
      }
    },
    i2v: {
      mediaInputs: { firstFrame: true },
      supports: {
        resolution: { type: 'enum', options: ['720p'], default: '720p' }
      }
    }
  }
}

describe('videoGenerationToFields', () => {
  it('maps the requested mode’s supports to BaseConfigItems (enum→select, range→slider, text→input/textarea, switch)', () => {
    const fields = videoGenerationToFields(support, { mode: 't2v' })
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]))

    expect(byKey.resolution).toMatchObject({
      type: 'select',
      title: 'paintings.video.resolution',
      initialValue: '720p'
    })
    expect(byKey.resolution.options).toEqual([
      { label: '720p', value: '720p' },
      { label: '1080p', value: '1080p' }
    ])
    expect(byKey.aspectRatio).toMatchObject({ type: 'select', title: 'paintings.aspect_ratio' })
    expect(byKey.duration).toMatchObject({
      type: 'slider',
      min: 4,
      max: 12,
      initialValue: 5,
      title: 'paintings.video.duration'
    })
    expect(byKey.seed).toMatchObject({ type: 'input', title: 'paintings.seed' })
    expect(byKey.negativePrompt).toMatchObject({ type: 'textarea' }) // multiline text
    expect(byKey.watermark).toMatchObject({ type: 'switch', initialValue: false })
    expect(byKey.generateAudio).toMatchObject({ type: 'switch', initialValue: true })
  })

  it('does NOT emit media inputs as fields (only scalar supports)', () => {
    const fields = videoGenerationToFields(support, { mode: 'i2v' })
    expect(fields.map((f) => f.key)).toEqual(['resolution'])
    expect(fields.some((f) => f.key === 'firstFrame')).toBe(false)
  })

  it('falls back to the first declared mode when the requested mode is absent', () => {
    const fields = videoGenerationToFields(support, { mode: 'keyframe' })
    // 'keyframe' is not declared → falls back to the first mode (t2v)
    expect(fields.map((f) => f.key)).toContain('duration')
  })

  it('uses option label keys where declared (movementAmplitude / shotType)', () => {
    const withEnums: VideoGenerationSupport = {
      modes: {
        t2v: {
          supports: {
            movementAmplitude: { type: 'enum', options: ['auto', 'large'], default: 'auto' },
            shotType: { type: 'enum', options: ['single', 'multi'], default: 'single' }
          }
        }
      }
    }
    const fields = videoGenerationToFields(withEnums, { mode: 't2v' })
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]))
    expect(byKey.movementAmplitude.options).toEqual([
      { labelKey: 'paintings.video.movement_amplitude_options.auto', value: 'auto' },
      { labelKey: 'paintings.video.movement_amplitude_options.large', value: 'large' }
    ])
    expect(byKey.shotType.options).toEqual([
      { labelKey: 'paintings.video.shot_type_options.single', value: 'single' },
      { labelKey: 'paintings.video.shot_type_options.multi', value: 'multi' }
    ])
  })

  it('returns [] for undefined support or a support with no modes', () => {
    expect(videoGenerationToFields(undefined)).toEqual([])
    expect(videoGenerationToFields({ modes: {} })).toEqual([])
  })
})
