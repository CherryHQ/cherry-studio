import { describe, expect, it } from 'vitest'

import { inferenceWorkerSource } from '../inferenceWorkerSource'
import { l2normalize } from '../pooling'

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

  it('is baked into the inference worker source verbatim (single source, no drift)', () => {
    // The worker runs as an eval'd string and cannot import project modules, so this
    // function is injected via `.toString()`. Pin that the executed copy IS this tested
    // one — if someone re-inlines a divergent copy, this fails.
    expect(inferenceWorkerSource).toContain(l2normalize.toString())
    expect(inferenceWorkerSource).toContain('const l2normalize =')
  })
})
