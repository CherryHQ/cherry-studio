import { describe, expect, it } from 'vitest'

import { __internal, isIBeamHotspot } from '../cursorUtils'

describe('cursorUtils — isIBeamHotspot', () => {
  it('accepts exact known hotspots', () => {
    expect(isIBeamHotspot({ x: 4, y: 9 })).toBe(true)
    expect(isIBeamHotspot({ x: 16, y: 16 })).toBe(true)
    expect(isIBeamHotspot({ x: 12, y: 11 })).toBe(true)
  })

  it('accepts the macOS 26.6.2 fractional hotspot (11.5, 11.0)', () => {
    expect(isIBeamHotspot({ x: 11.5, y: 11.0 })).toBe(true)
  })

  it('accepts other fractional Retina variants within tolerance', () => {
    expect(isIBeamHotspot({ x: 11.6, y: 10.8 })).toBe(true)
    expect(isIBeamHotspot({ x: 12.4, y: 11.3 })).toBe(true)
    expect(isIBeamHotspot({ x: 4.3, y: 9.4 })).toBe(true)
    expect(isIBeamHotspot({ x: 16.5, y: 16.4 })).toBe(true)
  })

  it('rejects hotspots outside tolerance', () => {
    expect(isIBeamHotspot({ x: 0, y: 0 })).toBe(false)
    expect(isIBeamHotspot({ x: 11.5, y: 13 })).toBe(false)
    expect(isIBeamHotspot({ x: 20, y: 20 })).toBe(false)
    expect(isIBeamHotspot({ x: 4, y: 16 })).toBe(false)
  })

  it('rejects non-I-beam hotspot at exact tolerance boundary (strict <)', () => {
    // At exactly 0.6 away, the native < kEpsilon check rejects — mirror that.
    expect(isIBeamHotspot({ x: 12 + __internal.HOTSPOT_TOLERANCE, y: 11 })).toBe(false)
    expect(isIBeamHotspot({ x: 12, y: 11 + __internal.HOTSPOT_TOLERANCE })).toBe(false)
  })

  it('tolerance can be overridden', () => {
    expect(isIBeamHotspot({ x: 13, y: 11 }, 1.5)).toBe(true)
    expect(isIBeamHotspot({ x: 13, y: 11 }, 0.5)).toBe(false)
  })
})
