import { describe, expect, it } from 'vitest'

import { SpeedMeter } from '../speedMeter'

describe('SpeedMeter', () => {
  it('reports zero until it has two samples', () => {
    const meter = new SpeedMeter()

    expect(meter.update('a', 0, 1_000)).toBe(0)
    expect(meter.get('a', 1_000)).toBe(0)
  })

  it('measures bytes per second between samples', () => {
    const meter = new SpeedMeter()

    meter.update('a', 0, 1_000)
    expect(meter.update('a', 2_000_000, 2_000)).toBe(2_000_000)
    expect(meter.get('a', 2_000)).toBe(2_000_000)
  })

  it('smooths a changing rate instead of jumping to the newest sample', () => {
    const meter = new SpeedMeter()

    meter.update('a', 0, 0)
    meter.update('a', 1_000_000, 1_000)
    // 4 MB/s on the second interval: 40% of the new rate, 60% of the previous.
    expect(meter.update('a', 5_000_000, 2_000)).toBe(2_200_000)
  })

  it('ignores samples that arrive too close together', () => {
    const meter = new SpeedMeter()

    meter.update('a', 0, 0)
    meter.update('a', 1_000_000, 1_000)
    expect(meter.update('a', 1_100_000, 1_100)).toBe(1_000_000)
    // The baseline stayed at the 1 s sample, so the next full interval still measures correctly.
    expect(meter.update('a', 2_000_000, 2_000)).toBe(1_000_000)
  })

  it('resets the rate when a retry reports a lower byte count', () => {
    const meter = new SpeedMeter()

    meter.update('a', 0, 0)
    meter.update('a', 1_000_000, 1_000)
    expect(meter.update('a', 0, 1_500)).toBe(0)
    expect(meter.get('a', 1_500)).toBe(0)
  })

  it('reads as zero once a task stops reporting', () => {
    const meter = new SpeedMeter()

    meter.update('a', 0, 0)
    meter.update('a', 1_000_000, 1_000)

    expect(meter.get('a', 4_000)).toBe(1_000_000)
    expect(meter.get('a', 7_000)).toBe(0)
  })

  it('forgets a task on stop', () => {
    const meter = new SpeedMeter()

    meter.update('a', 0, 0)
    meter.update('a', 1_000_000, 1_000)
    meter.stop('a')

    expect(meter.get('a', 1_000)).toBe(0)
  })
})
