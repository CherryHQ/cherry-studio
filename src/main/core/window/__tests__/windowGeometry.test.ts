import type { BrowserWindowConstructorOptions, Rectangle } from 'electron'
import { describe, expect, it } from 'vitest'

import { clampWindowBounds, fitWindowOptionsToWorkArea } from '../windowGeometry'

const defaults = () => ({ width: 960, height: 600, minWidth: 960, minHeight: 600 })
const portrait = { x: 0, y: 0, width: 914, height: 1400 }

function expectInside(config: BrowserWindowConstructorOptions, area: Rectangle) {
  expect(config.x!).toBeGreaterThanOrEqual(area.x)
  expect(config.y!).toBeGreaterThanOrEqual(area.y)
  expect(config.x! + config.width!).toBeLessThanOrEqual(area.x + area.width)
  expect(config.y! + config.height!).toBeLessThanOrEqual(area.y + area.height)
}

describe('fitWindowOptionsToWorkArea', () => {
  it.each([
    [
      'portrait first launch',
      portrait,
      defaults(),
      { width: 914, height: 600, minWidth: 914, minHeight: 600, x: 0, y: 400 }
    ],
    [
      'wide restore',
      portrait,
      { ...defaults(), x: 40, y: 100, width: 1200, height: 800 },
      { width: 914, height: 800, minWidth: 914, minHeight: 600, x: 0, y: 100 }
    ],
    [
      'compact restore',
      portrait,
      { ...defaults(), x: 100, y: 100, width: 800 },
      { width: 914, height: 600, minWidth: 914, minHeight: 600, x: 0, y: 100 }
    ],
    [
      'normal display floor',
      { x: 0, y: 0, width: 1000, height: 800 },
      { ...defaults(), x: 200, y: 100, width: 800 },
      { width: 960, height: 600, minWidth: 960, minHeight: 600, x: 40, y: 100 }
    ],
    [
      'short display',
      { x: 0, y: 0, width: 1280, height: 480 },
      defaults(),
      { width: 960, height: 480, minWidth: 960, minHeight: 480, x: 160, y: 0 }
    ],
    [
      'width below threshold',
      { x: 0, y: 0, width: 959, height: 600 },
      defaults(),
      { width: 959, height: 600, minWidth: 959, minHeight: 600, x: 0, y: 0 }
    ],
    [
      'height below threshold',
      { x: 0, y: 0, width: 960, height: 599 },
      defaults(),
      { width: 960, height: 599, minWidth: 960, minHeight: 599, x: 0, y: 0 }
    ],
    [
      'negative origin',
      { x: -914, y: 30, width: 914, height: 1400 },
      defaults(),
      { width: 914, height: 600, minWidth: 914, minHeight: 600, x: -914, y: 430 }
    ],
    [
      'offset work area',
      { x: 40, y: 30, width: 874, height: 1370 },
      defaults(),
      { width: 874, height: 600, minWidth: 874, minHeight: 600, x: 40, y: 415 }
    ]
  ])('%s stays within the work area and is idempotent', (_name, area, input, expected) => {
    const config: BrowserWindowConstructorOptions = { ...input }
    const originalArea = { ...area }
    fitWindowOptionsToWorkArea(config, area)
    expect(config).toEqual(expected)
    expectInside(config, area)
    fitWindowOptionsToWorkArea(config, area)
    expect(config).toEqual(expected)
    expect(area).toEqual(originalArea)
  })

  it.each([
    [{ x: 0, y: 0, width: 960, height: 600 }, defaults()],
    [
      { x: 0, y: 0, width: 1920, height: 1040 },
      { x: 100, y: 100, width: 1100, height: 720, minWidth: 960, minHeight: 600 }
    ]
  ])('preserves every field when no adjustment is needed', (area, input) => {
    const config = { ...input }
    fitWindowOptionsToWorkArea(config, area)
    expect(config).toEqual(input)
  })

  it.each([
    [portrait, { minWidth: 520, minHeight: 600 }],
    [
      { x: 0, y: 0, width: 480, height: 800 },
      { minWidth: 480, minHeight: 600 }
    ]
  ])('only clamps minimums for min-only input', (area, expected) => {
    const config = { minWidth: 520, minHeight: 600 }
    fitWindowOptionsToWorkArea(config, area)
    expect(config).toEqual(expected)
    fitWindowOptionsToWorkArea(config, area)
    expect(config).toEqual(expected)
  })

  it('does not invent missing dimensions or Electron defaults', () => {
    const config = { width: 1200 }
    fitWindowOptionsToWorkArea(config, portrait)
    expect(config).toEqual({ width: 914 })
  })
})

describe('clampWindowBounds', () => {
  it('shrinks dimensions and clamps to a negative, offset origin without mutating inputs', () => {
    const rect = { x: -1500, y: 1800, width: 1200, height: 1600 }
    const area = { x: -914, y: 30, width: 914, height: 1400 }
    expect(clampWindowBounds(rect, area)).toEqual({ x: -914, y: 30, width: 914, height: 1400 })
    expect(rect).toEqual({ x: -1500, y: 1800, width: 1200, height: 1600 })
    expect(area).toEqual({ x: -914, y: 30, width: 914, height: 1400 })
  })
})
