import { describe, expect, it, vi } from 'vitest'

import { PerfRecorder } from '../PerfRecorder'

/** 可控时钟：每次调用返回队列里的下一个值，用尽后停在最后一个。 */
function clockOf(...values: number[]) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]
}

/** 单调递增时钟，步长固定。 */
function tickingClock(step = 1) {
  let value = 0
  return () => (value += step)
}

describe('PerfRecorder disabled', () => {
  it('records nothing and never touches the clock', () => {
    const now = vi.fn(() => 0)
    const recorder = new PerfRecorder({ enabled: false, now })

    const handle = recorder.start('anything')
    handle.end()

    expect(recorder.snapshot()).toEqual([])
    expect(now).not.toHaveBeenCalled()
  })

  it('returns the same frozen handle every time so a hot path allocates nothing', () => {
    const recorder = new PerfRecorder({ enabled: false })
    expect(recorder.start('a')).toBe(recorder.start('b'))
  })
})

describe('PerfRecorder enabled', () => {
  it('measures duration from the injected clock', () => {
    const recorder = new PerfRecorder({ enabled: true, now: clockOf(100, 350) })

    recorder.start('DbService.init').end()

    const [span] = recorder.snapshot()
    expect(span.startTime).toBe(100)
    expect(span.duration).toBe(250)
  })

  it('defaults an unspecified track to custom', () => {
    const recorder = new PerfRecorder({ enabled: true, now: clockOf(0, 1) })
    recorder.start('thing').end()
    expect(recorder.snapshot()[0].track).toBe('custom')
  })

  it('links a child span to its parent by id', () => {
    const recorder = new PerfRecorder({ enabled: true, now: tickingClock() })

    const parent = recorder.start('phase:beforeReady', { track: 'bootstrap' })
    const child = recorder.start('DbService.init', { track: 'bootstrap', parent })
    child.end()
    parent.end()

    const childSpan = recorder.snapshot().find((span) => span.name === 'DbService.init')
    expect(childSpan?.parentId).toBe(parent.id)
  })

  it('leaves parentId undefined for a top-level span', () => {
    const recorder = new PerfRecorder({ enabled: true, now: tickingClock() })
    recorder.start('root').end()
    expect(recorder.snapshot()[0].parentId).toBeUndefined()
  })

  it('merges the detail passed to end() over the one passed to start()', () => {
    const recorder = new PerfRecorder({ enabled: true, now: clockOf(0, 1) })

    recorder.start('embed', { detail: { chunk: 1, model: 'a' } }).end({ model: 'b', vectors: 42 })

    expect(recorder.snapshot()[0].detail).toEqual({ chunk: 1, model: 'b', vectors: 42 })
  })

  it('ignores a second end() so a double-ended span cannot be double counted', () => {
    const recorder = new PerfRecorder({ enabled: true, now: clockOf(0, 5, 900) })

    const handle = recorder.start('once')
    handle.end()
    handle.end()

    expect(recorder.snapshot()).toHaveLength(1)
    expect(recorder.snapshot()[0].duration).toBe(5)
  })

  it('drops the oldest spans once the ring buffer is full, keeping insertion order', () => {
    const recorder = new PerfRecorder({ enabled: true, maxSpans: 3, now: () => 0 })

    for (const name of ['a', 'b', 'c', 'd', 'e']) recorder.start(name).end()

    expect(recorder.snapshot().map((span) => span.name)).toEqual(['c', 'd', 'e'])
  })

  it('keeps insertion order after the ring wraps more than once', () => {
    const recorder = new PerfRecorder({ enabled: true, maxSpans: 3, now: () => 0 })

    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) recorder.start(name).end()

    expect(recorder.snapshot().map((span) => span.name)).toEqual(['e', 'f', 'g'])
  })

  it('emits onSpan exactly once per completed span, not on start', () => {
    const recorder = new PerfRecorder({ enabled: true, now: clockOf(0, 1) })
    const seen: string[] = []
    recorder.onSpan((span) => seen.push(span.name))

    const handle = recorder.start('emitted')
    expect(seen).toEqual([])
    handle.end()

    expect(seen).toEqual(['emitted'])
  })

  it('clear() empties the buffer', () => {
    const recorder = new PerfRecorder({ enabled: true, now: tickingClock() })
    recorder.start('a').end()
    recorder.clear()
    expect(recorder.snapshot()).toEqual([])
  })

  it('still records the span when a non-cloneable detail breaks performance.measure', () => {
    const recorder = new PerfRecorder({ enabled: true, now: clockOf(0, 1) })

    // A function value makes structuredClone throw inside performance.measure.
    expect(() => recorder.start('uncloneable', { detail: { onDone: () => undefined } }).end()).not.toThrow()
    expect(recorder.snapshot()).toHaveLength(1)
    expect(performance.getEntriesByName('uncloneable', 'measure')).toHaveLength(1)
  })

  it('writes each completed span to the perf_hooks timeline', () => {
    const measure = vi.spyOn(performance, 'measure').mockImplementation(() => undefined as never)
    const recorder = new PerfRecorder({ enabled: true, now: clockOf(10, 60) })

    recorder.start('timeline').end()

    expect(measure).toHaveBeenCalledWith('timeline', expect.objectContaining({ start: 10, end: 60 }))
    measure.mockRestore()
  })
})
