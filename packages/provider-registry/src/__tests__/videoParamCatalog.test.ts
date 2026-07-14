import { describe, expect, it } from 'vitest'

import { CANONICAL_VIDEO_PARAM_KEY } from '../schemas/enums'
import type { VideoGenerationSupport } from '../schemas/model'
import { VIDEO_PARAM_CATALOG_KEYS, videoParamsSchema } from '../schemas/videoParamCatalog'
import { buildVideoParamsSchema } from '../utils/buildVideoParamsSchema'

describe('VIDEO_PARAM_CATALOG', () => {
  it('is exhaustive over CANONICAL_VIDEO_PARAM_KEY (no missing / extra keys)', () => {
    expect([...VIDEO_PARAM_CATALOG_KEYS].sort()).toEqual(Object.values(CANONICAL_VIDEO_PARAM_KEY).sort())
  })
})

describe('videoParamsSchema (catalog-only IPC boundary schema)', () => {
  it('coerces canonical value types (duration/seed/fps string → number)', () => {
    expect(videoParamsSchema.parse({ duration: '5', seed: '42', fps: '24', negativePrompt: 'blur' })).toEqual({
      duration: 5,
      seed: 42,
      fps: 24,
      negativePrompt: 'blur'
    })
  })

  it('treats blank numeric inputs as omitted (not 0/NaN)', () => {
    expect(videoParamsSchema.parse({ seed: '', duration: '' })).toEqual({})
  })

  it('keeps catalog keys and strips non-catalog keys (z.infer is exactly VideoParamValues)', () => {
    expect(videoParamsSchema.parse({ cfg: 7.5, cameraFixed: true, notAParam: 'x' })).toEqual({
      cfg: 7.5,
      cameraFixed: true
    })
  })
})

describe('buildVideoParamsSchema', () => {
  const support = {
    modes: {
      t2v: {
        supports: {
          seed: { type: 'text' },
          duration: { type: 'enum', options: ['5', '10'] },
          resolution: { type: 'enum', options: ['720p', '1080p'] },
          cfg: { type: 'range', min: 1, max: 10 }
        }
      },
      i2v: {
        supports: {
          resolution: { type: 'enum', options: ['720p'] }
        }
      }
    }
  } as unknown as VideoGenerationSupport

  const schema = buildVideoParamsSchema(support, 't2v')

  it('coerces the form string seed to a number once', () => {
    expect(schema.parse({ seed: '42' })).toMatchObject({ seed: 42 })
  })

  it('treats a blank seed as omitted (not 0)', () => {
    expect(schema.parse({ seed: '' }).seed).toBeUndefined()
  })

  it('coerces an enum duration ("5" → 5) while enforcing membership', () => {
    expect(schema.parse({ duration: '5' }).duration).toBe(5)
    expect(schema.parse({ duration: '7' }).duration).toBeUndefined()
  })

  it('drops an out-of-range value instead of failing the whole submit', () => {
    expect(schema.parse({ cfg: 99 }).cfg).toBeUndefined()
    expect(schema.parse({ cfg: 7 }).cfg).toBe(7)
  })

  it('enforces enum membership', () => {
    expect(schema.parse({ resolution: '720p' }).resolution).toBe('720p')
    expect(schema.parse({ resolution: '4k' }).resolution).toBeUndefined()
  })

  it('resolves the requested mode, falling back to the first declared mode', () => {
    const i2v = buildVideoParamsSchema(support, 'i2v')
    expect(i2v.parse({ resolution: '1080p' }).resolution).toBeUndefined()
    // 'extend' is not declared → falls back to t2v (the first declared mode).
    const fallback = buildVideoParamsSchema(support, 'extend')
    expect(fallback.parse({ resolution: '1080p' }).resolution).toBe('1080p')
  })

  it('coerces catalog keys the model does not declare (stale cross-model leftovers)', () => {
    // `fps` is not in this model's supports but IS a catalog key: it must be
    // coerced (not ride raw through `.loose()`) so the strict IPC schema accepts it.
    expect(schema.parse({ fps: '24' }).fps).toBe(24)
  })

  it('returns the coercing base schema when the model declares no support block', () => {
    const bare = buildVideoParamsSchema(undefined)
    expect(bare.parse({ seed: '7', watermark: true })).toMatchObject({ seed: 7, watermark: true })
  })
})
