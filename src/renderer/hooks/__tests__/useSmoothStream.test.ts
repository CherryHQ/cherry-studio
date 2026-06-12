import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSmoothStream } from '../useSmoothStream'

/**
 * The hook reads its clock from `performance.now()` (single clock for both
 * arrival timestamps and frame `dt`). Tests drive `clock` manually and run
 * queued rAF callbacks. `cancelAnimationFrame` actually removes a pending
 * frame (a no-op cancel would let stale loop closures run alongside new ones,
 * e.g. across a `streamDone` rerender).
 */
let clock = 0
let rafCallbacks = new Map<number, FrameRequestCallback>()
let rafId = 0

/** Advance the clock by `ms` and run one generation of queued frames. */
function tick(ms = 16, frames = 1): void {
  for (let f = 0; f < frames; f++) {
    clock += ms
    const batch = rafCallbacks
    rafCallbacks = new Map()
    for (const cb of batch.values()) cb(0)
  }
}

const lastText = (fn: ReturnType<typeof vi.fn>): string => (fn.mock.calls.at(-1)?.[0] as string) ?? ''

/** Mirrors the hook's internal MAX_BACKLOG (not exported). */
const MAX_BACKLOG = 400

beforeEach(() => {
  clock = 0
  rafCallbacks = new Map()
  rafId = 0
  vi.stubGlobal('performance', { now: () => clock } as Performance)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafId += 1
    rafCallbacks.set(rafId, cb)
    return rafId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafCallbacks.delete(id)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSmoothStream', () => {
  // A burst can accumulate before the first frame; that frame must not dump
  // it. With no reference dt / rate sample yet it reveals exactly MIN_STEP.
  it('reveals only MIN_STEP on the first frame, never a dump', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 0 }))

    act(() => result.current.addChunk('a'.repeat(100)))
    act(() => tick(16))

    expect(lastText(onUpdate).length).toBe(1)
  })

  it('reveals progressively and eventually shows the full text', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 0 }))

    act(() => result.current.addChunk('abcdefghij'))
    act(() => tick(16, 60))

    expect(onUpdate).toHaveBeenLastCalledWith('abcdefghij')
  })

  // Regression: the loop must stay alive after the queue drains to exactly 0
  // mid-stream so a later addChunk is still revealed.
  it('keeps revealing after the queue drains to zero mid-stream', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 0 }))

    act(() => result.current.addChunk('abc'))
    act(() => tick(16, 80)) // generous: this asserts liveness, not speed
    expect(lastText(onUpdate)).toBe('abc')

    act(() => tick(16, 5)) // backend gap, queue empty, still streaming
    act(() => result.current.addChunk('def'))
    act(() => tick(16, 80))

    expect(onUpdate).toHaveBeenLastCalledWith('abcdef')
  })

  it('stops and shows final text once streamDone with an empty queue', () => {
    const onUpdate = vi.fn()
    const { result, rerender } = renderHook(
      ({ done }: { done: boolean }) => useSmoothStream({ onUpdate, streamDone: done, minDelay: 0 }),
      { initialProps: { done: false } }
    )

    act(() => result.current.addChunk('hi'))
    act(() => tick(16, 80))
    expect(lastText(onUpdate)).toBe('hi')

    rerender({ done: true })
    act(() => tick(16))
    const callsAfterDone = onUpdate.mock.calls.length
    act(() => tick(16, 5))
    expect(onUpdate.mock.calls.length).toBe(callsAfterDone)
    expect(onUpdate).toHaveBeenLastCalledWith('hi')
  })

  // Hard latency ceiling while streaming: with a 1000-grapheme backlog the
  // catch-up frame drains down to exactly MAX_BACKLOG (400). Frame 1 reveals
  // MIN_STEP (1); frame 2 catches up: 999 - 400 = 599 → displayed 600.
  it('caps backlog to MAX_BACKLOG while streaming', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 0 }))

    act(() => result.current.addChunk('a'.repeat(1000)))
    act(() => tick(16)) // frame 1: MIN_STEP → 1
    act(() => tick(16)) // frame 2: catch-up → 600

    expect(lastText(onUpdate).length).toBe(600)
  })

  // After streamDone the tail must beat the old fixed 5/frame: frame 1 is
  // MIN_STEP, then a 999 tail reveals ceil(999*16/(2*1000))=8 (> 5).
  it('drains a huge tail faster than the gentle step once streamDone', () => {
    const onUpdate = vi.fn()
    const { result, rerender } = renderHook(
      ({ done }: { done: boolean }) => useSmoothStream({ onUpdate, streamDone: done, minDelay: 0 }),
      { initialProps: { done: false } }
    )

    act(() => result.current.addChunk('a'.repeat(1000)))
    rerender({ done: true })
    act(() => tick(16)) // frame 1: MIN_STEP → 1
    const afterFirst = lastText(onUpdate).length
    act(() => tick(16)) // frame 2: tail step
    expect(lastText(onUpdate).length - afterFirst).toBeGreaterThan(5)

    act(() => tick(16, 5000))
    expect(onUpdate).toHaveBeenLastCalledWith('a'.repeat(1000))
  })

  // After a long background gap (rAF frozen) the resume frame must not dump
  // the whole queue — dt is clamped and MAX_BACKLOG bounds the catch-up.
  it('bounds the queue after a long background gap instead of dumping it', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 0 }))

    act(() => result.current.addChunk('a'.repeat(1000)))
    act(() => tick(16)) // frame 1: MIN_STEP → 1
    act(() => tick(100_000)) // tab hidden ~100s, then one resume frame

    expect(lastText(onUpdate).length).toBe(600)
    expect(lastText(onUpdate).length).toBeLessThan(1000)
  })

  it('reset clears the queue and does not resurrect old text', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 0 }))

    act(() => result.current.addChunk('hello world'))
    act(() => tick(16))
    act(() => result.current.reset('X'))
    expect(lastText(onUpdate)).toBe('X')

    act(() => tick(16, 5))
    expect(lastText(onUpdate)).toBe('X')
  })

  // Regression: the startup/TTFT wait (idle, queue empty, pre-first-token)
  // is measured as the first arrival's gap and arms the cushion. The first
  // burst is then HELD back as buffer instead of being dumped in ~2 frames —
  // which is what lets the *first* mid-stream stall play out continuously
  // instead of dump-then-freeze. Without the startup arming (control: a chunk
  // that arrives immediately, no idle to stamp/measure) the burst is dumped.
  it('arms the cushion from the startup gap so the first burst is held, not dumped', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 0 }))

    // ~3s startup wait: idle frames stamp stream-start on the first one.
    act(() => tick(1000, 3))
    // First token after the long TTFT → gap ≫ ARM → cushion armed to CAP.
    act(() => result.current.addChunk('a'.repeat(200)))
    act(() => tick(16)) // first content frame: MIN_STEP only
    act(() => tick(16, 10)) // 10 streaming frames

    const held = lastText(onUpdate).length
    // Cushion armed → played near the sustained rate, burst largely retained
    // (not dumped): progressing, but the bulk still queued for the imminent
    // first stall.
    expect(held).toBeGreaterThan(0)
    expect(held).toBeLessThan(90)
    expect(200 - held).toBeGreaterThan(100)

    // Control: same burst with NO startup idle → no gap to measure → cushion
    // stays at FLOOR → restoring force dumps the burst within those frames.
    const onUpdate2 = vi.fn()
    const { result: r2 } = renderHook(() => useSmoothStream({ onUpdate: onUpdate2, streamDone: false, minDelay: 0 }))
    act(() => r2.current.addChunk('a'.repeat(200)))
    act(() => tick(16))
    act(() => tick(16, 10))
    const dumped = lastText(onUpdate2).length
    expect(dumped).toBeGreaterThan(100)

    // The armed stream reveals far less than the unarmed one over the same
    // frames — proof the startup gap built (and retained) the cushion.
    expect(held * 2).toBeLessThan(dumped)
  })

  // Bursty but high average rate (dense token then inter-chunk gap): the
  // jitter cushion must keep the queue from draining to empty during the
  // gap, so there is no micro-stutter. Backlog stays regulated near target
  // (not drifting to 0, not growing unbounded), and everything completes.
  it('keeps a cushion so a bursty-high-average stream never underruns', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 0 }))

    const BURST = 20
    const FRAMES_PER_CYCLE = 8 // 128ms gap between bursts → ~156 graphemes/s
    let received = 0
    let minBacklogAfterWarmup = Infinity
    let maxBacklogAfterWarmup = 0

    for (let cycle = 0; cycle < 40; cycle++) {
      act(() => result.current.addChunk('a'.repeat(BURST)))
      received += BURST
      for (let f = 0; f < FRAMES_PER_CYCLE; f++) act(() => tick(16))

      const shown = lastText(onUpdate).length
      expect(shown).toBeLessThanOrEqual(received) // never show unreceived text
      if (cycle >= 20) {
        const backlog = received - shown // low point: just before next burst
        minBacklogAfterWarmup = Math.min(minBacklogAfterWarmup, backlog)
        maxBacklogAfterWarmup = Math.max(maxBacklogAfterWarmup, backlog)
      }
    }

    // Cushion held: queue never emptied between bursts.
    expect(minBacklogAfterWarmup).toBeGreaterThan(0)
    // Regulated near target, not drifting up toward the MAX_BACKLOG ceiling.
    expect(maxBacklogAfterWarmup).toBeLessThan(MAX_BACKLOG)

    // Stops feeding: the restoring term drains the cushion and completes.
    act(() => tick(16, 300))
    expect(lastText(onUpdate)).toBe('a'.repeat(received))
  })

  // P1 regression: reset() cancels the in-flight rAF; when streamDone does
  // not change value nothing used to reschedule it, so a post-reset addChunk
  // was stranded (frozen until stream end). The loop must revive.
  it('keeps playing after reset() followed by addChunk', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 0 }))

    act(() => result.current.addChunk('first'))
    act(() => tick(16, 40))
    act(() => result.current.reset(''))
    expect(lastText(onUpdate)).toBe('')

    act(() => result.current.addChunk('hello'))
    act(() => tick(16, 200))
    expect(onUpdate).toHaveBeenLastCalledWith('hello')
  })

  // P3 regression: dt was clamped to MAX_FRAME_DT_MS *before* the minDelay
  // throttle, so any minDelay > 100 made `dt < minDelay` always true and
  // nothing ever played. Throttling on unclamped elapsed fixes it.
  it('still outputs when minDelay exceeds MAX_FRAME_DT_MS', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 200 }))

    act(() => result.current.addChunk('abcde'))
    act(() => tick(250, 40)) // 250ms/frame ≥ minDelay → frames proceed
    expect(onUpdate).toHaveBeenLastCalledWith('abcde')
  })

  // P2 regression: MIN_STEP used to force ≥1 grapheme/frame (~60/s at 60fps),
  // dumping a slow stream then stalling. Fractional credit plays sub-1/frame.
  it('does not dump a slow stream at the MIN_STEP floor', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 0 }))

    act(() => result.current.addChunk('abc'))
    act(() => tick(16, 10))
    // Old behaviour: 1/frame → 'abc' fully shown within 3 frames. New: the
    // sustained rate is low, so it is still mid-reveal after 10 frames.
    const partial = lastText(onUpdate).length
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(3)

    act(() => tick(16, 400)) // liveness: still completes eventually
    expect(lastText(onUpdate)).toBe('abc')
  })

  // P4 regression: update() assumed monotonic prefix extension, but callers
  // trim on completion (TranslateService). The final displayed text must
  // equal the resolved/saved value, not keep the untrimmed whitespace.
  it('reconciles a trimmed completion so UI matches the resolved text', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, minDelay: 0 }))

    act(() => result.current.update('hello   ', false))
    act(() => tick(16, 60))
    act(() => result.current.update('hello', true)) // trimmed on done
    act(() => tick(16, 60))

    expect(lastText(onUpdate)).toBe('hello')
  })
})
