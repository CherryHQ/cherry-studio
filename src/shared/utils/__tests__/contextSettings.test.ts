import { describe, expect, it } from 'vitest'

import { clampKeepPercent, clampThresholdPercent } from '../contextSettings'

describe('context percentage normalization', () => {
  it.each([
    [5, 10],
    [95, 90],
    [37.5, 37.5],
    [62.3, 62.3],
    [null, 37.5],
    [undefined, 37.5],
    [NaN, 37.5],
    [Infinity, 37.5],
    [-Infinity, 37.5]
  ])('clamps keep %s to %s', (value, expected) => {
    expect(clampKeepPercent(value)).toBe(expected)
  })
  it.each([
    [20, 20],
    [200, 100],
    [NaN, 80]
  ])('preserves trigger normalization for %s', (value, expected) => {
    expect(clampThresholdPercent(value)).toBe(expected)
  })
})
