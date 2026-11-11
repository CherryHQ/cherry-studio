import { describe, expect, it } from 'vitest'

import { measureTranslationText } from '../utils/measureTranslationText'

function contextWith(metrics: Partial<TextMetrics> = {}): CanvasRenderingContext2D {
  return {
    measureText: () => ({
      width: 64.05,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 63.06,
      fontBoundingBoxAscent: 20,
      fontBoundingBoxDescent: 4,
      ...metrics
    })
  } as CanvasRenderingContext2D
}

describe('measureTranslationText', () => {
  it('preserves positive left overhang', () => {
    expect(measureTranslationText(contextWith({ actualBoundingBoxLeft: 2 }), 'jungle', 24).left).toBe(2)
  })

  it('clamps a negative left extent to zero', () => {
    expect(measureTranslationText(contextWith({ actualBoundingBoxLeft: -1 }), 'jungle', 24).left).toBe(0)
  })

  it('falls back for non-finite font bounding boxes', () => {
    const metrics = measureTranslationText(
      contextWith({ fontBoundingBoxAscent: NaN, fontBoundingBoxDescent: NaN }),
      'jungle',
      40
    )
    expect(metrics.ascent).toBe(32)
    expect(metrics.descent).toBe(8)
  })

  it('passes through width and the right extent unchanged', () => {
    const metrics = measureTranslationText(contextWith(), 'jungle', 24)
    expect(metrics.width).toBe(64.05)
    expect(metrics.right).toBe(63.06)
  })
})
