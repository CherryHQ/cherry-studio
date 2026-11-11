import { describe, expect, it } from 'vitest'

import { sampleTranslationBackground } from '../utils/sampleTranslationBackground'

describe('sampleTranslationBackground', () => {
  it('uses the median of the ring and excludes other OCR rectangles', () => {
    const data = new Uint8ClampedArray(5 * 5 * 4)
    for (let i = 0; i < data.length; i += 4) data.set([20, 30, 40, 255], i)
    data.set([255, 255, 255, 255], 0)
    expect(
      sampleTranslationBackground({ width: 5, height: 5, data } as ImageData, { x: 2, y: 2, width: 1, height: 1 }, [
        { x: 0, y: 0, width: 1, height: 1 }
      ])
    ).toEqual({ r: 20, g: 30, b: 40 })
  })
  it('returns null for transparent edge samples', () => {
    const data = new Uint8ClampedArray(16)
    expect(
      sampleTranslationBackground({ width: 2, height: 2, data } as ImageData, { x: 0, y: 0, width: 1, height: 1 }, [])
    ).toBeNull()
  })
})
