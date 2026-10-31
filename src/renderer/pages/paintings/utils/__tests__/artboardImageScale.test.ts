import { describe, expect, it } from 'vitest'

import {
  DEFAULT_IMAGE_SCALE,
  IMAGE_SCALE_STEP,
  MAX_IMAGE_SCALE,
  MIN_IMAGE_SCALE,
  nextImageScaleFromWheel
} from '../artboardImageScale'

describe('nextImageScaleFromWheel', () => {
  it('zooms in on wheel up and out on wheel down by one toolbar step', () => {
    // Regression: hovering the artboard and scrolling must change scale the same
    // way as the Zoom In / Zoom Out toolbar buttons (#20739 / #19654).
    expect(nextImageScaleFromWheel(DEFAULT_IMAGE_SCALE, -100)).toBe(DEFAULT_IMAGE_SCALE + IMAGE_SCALE_STEP)
    expect(nextImageScaleFromWheel(DEFAULT_IMAGE_SCALE, 100)).toBe(DEFAULT_IMAGE_SCALE - IMAGE_SCALE_STEP)
  })

  it('clamps at the shared 0.25x–4x artboard limits', () => {
    // Regression: repeated wheel input must not escape the toolbar scale bounds.
    expect(nextImageScaleFromWheel(MIN_IMAGE_SCALE, 100)).toBe(MIN_IMAGE_SCALE)
    expect(nextImageScaleFromWheel(MAX_IMAGE_SCALE, -100)).toBe(MAX_IMAGE_SCALE)
  })

  it('ignores a zero or non-finite wheel delta without changing scale', () => {
    expect(nextImageScaleFromWheel(1.5, 0)).toBe(1.5)
    expect(nextImageScaleFromWheel(1.5, Number.NaN)).toBe(1.5)
  })
})
