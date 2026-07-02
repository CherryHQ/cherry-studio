import { describe, expect, it } from 'vitest'

import { l2normalize, lastTokenPool } from '../pooling'

describe('pooling', () => {
  it('l2normalize returns a unit vector', () => {
    const out = l2normalize([3, 4])
    expect(out[0]).toBeCloseTo(0.6)
    expect(out[1]).toBeCloseTo(0.8)
    const magnitude = Math.sqrt(out.reduce((sum, v) => sum + v * v, 0))
    expect(magnitude).toBeCloseTo(1)
  })

  it('l2normalize leaves a zero vector unchanged (no divide-by-zero)', () => {
    expect(l2normalize([0, 0, 0])).toEqual([0, 0, 0])
  })

  it('lastTokenPool takes the final token, then normalizes it', () => {
    const tokens = [
      [1, 0],
      [0, 0],
      [0, 5]
    ]
    expect(lastTokenPool(tokens)).toEqual([0, 1])
  })
})
