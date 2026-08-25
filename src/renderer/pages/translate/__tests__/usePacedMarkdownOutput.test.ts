import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MARKDOWN_RENDER_INTERVAL_MS,
  MARKDOWN_RENDER_STREAM_CADENCE_MS,
  usePacedMarkdownOutput
} from '../usePacedMarkdownOutput'

describe('usePacedMarkdownOutput', () => {
  let nowMs = 0

  beforeEach(() => {
    vi.useFakeTimers()
    nowMs = 0
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  /** Rerender at wall-time atMs, keeping the fake timer clock in lockstep. */
  const rerenderAt = (hook: { rerender: (props: { initial: string }) => void }, value: string, atMs: number) => {
    act(() => {
      vi.advanceTimersByTime(Math.max(0, atMs - nowMs))
      nowMs = atMs
      hook.rerender({ initial: value })
    })
  }

  it('emits the first value and discrete swaps after a quiet gap immediately', () => {
    const hook = renderHook(({ initial }) => usePacedMarkdownOutput(initial), { initialProps: { initial: 'first' } })
    expect(hook.result.current).toBe('first')

    // Quiet gap beyond cadence → the next change is discrete, not a stream frame.
    rerenderAt(hook, 'swapped document', MARKDOWN_RENDER_STREAM_CADENCE_MS + 50)
    expect(hook.result.current).toBe('swapped document')
  })

  it('coalesces a 16ms-frame stream into ~interval emissions of the latest value', () => {
    const stepMs = 16
    const hook = renderHook(({ initial }) => usePacedMarkdownOutput(initial), { initialProps: { initial: 'v0' } })
    const stepValues: Record<number, string> = {}
    const emissions: Array<{ step: number; value: string }> = []
    let lastSeen = hook.result.current

    for (let i = 1; i <= 40; i++) {
      const value = `v${i}`
      rerenderAt(hook, value, i * stepMs)
      stepValues[i] = value
      nowMs += stepMs
      act(() => {
        vi.advanceTimersByTime(stepMs)
      })
      if (hook.result.current !== lastSeen) {
        emissions.push({ step: i, value: hook.result.current })
        lastSeen = hook.result.current
      }
    }

    // 40 × 16ms = 640ms of streaming → exactly two paced emissions (~i=15, ~i=31),
    // each emitting the value of its own step — intermediates never surface.
    expect(emissions).toHaveLength(2)
    for (const { step, value } of emissions) {
      expect(value).toBe(stepValues[step])
    }
    expect(lastSeen).toBe(stepValues[emissions[1].step])
    const spacing = (emissions[1].step - emissions[0].step) * stepMs
    expect(spacing).toBeGreaterThanOrEqual(MARKDOWN_RENDER_INTERVAL_MS)
    expect(spacing).toBeLessThanOrEqual(MARKDOWN_RENDER_INTERVAL_MS + stepMs * 2)
  })

  it('emits the empty string immediately even mid-stream (pane clear must not wait)', () => {
    const hook = renderHook(({ initial }) => usePacedMarkdownOutput(initial), { initialProps: { initial: 'a' } })
    rerenderAt(hook, 'ab', 16)
    rerenderAt(hook, '', 32)
    expect(hook.result.current).toBe('')
    // The immediate emission supersedes the armed timer — nothing refills later.
    nowMs += MARKDOWN_RENDER_INTERVAL_MS * 2
    act(() => {
      vi.advanceTimersByTime(MARKDOWN_RENDER_INTERVAL_MS * 2)
    })
    expect(hook.result.current).toBe('')
  })

  it('supersedes an armed trailing timer on a discrete swap, keeping the next emission on cadence', () => {
    const hook = renderHook(({ initial }) => usePacedMarkdownOutput(initial), { initialProps: { initial: 'a' } })
    rerenderAt(hook, 'ab', 16) // stream frame → timer armed (would fire at ~250)
    // Quiet gap beyond cadence → discrete swap emits immediately and must
    // cancel the armed timer; frames after the swap arm a fresh full interval.
    const swapAt = 16 + MARKDOWN_RENDER_STREAM_CADENCE_MS + 60
    rerenderAt(hook, 'swapped', swapAt)
    expect(hook.result.current).toBe('swapped')
    rerenderAt(hook, 'swapped-x1', swapAt + 16)
    rerenderAt(hook, 'swapped-x2', swapAt + 32)

    // A stale pre-swap timer would fire at ~250 and emit 'swapped-x2' early.
    nowMs += MARKDOWN_RENDER_INTERVAL_MS - MARKDOWN_RENDER_STREAM_CADENCE_MS
    act(() => {
      vi.advanceTimersByTime(MARKDOWN_RENDER_INTERVAL_MS - MARKDOWN_RENDER_STREAM_CADENCE_MS)
    })
    expect(hook.result.current).toBe('swapped')
    nowMs += MARKDOWN_RENDER_STREAM_CADENCE_MS + 20
    act(() => {
      vi.advanceTimersByTime(MARKDOWN_RENDER_STREAM_CADENCE_MS + 20)
    })
    expect(hook.result.current).toBe('swapped-x2')
  })

  it('paces a swap that lands within cadence of the last stream frame (known residual)', () => {
    const hook = renderHook(({ initial }) => usePacedMarkdownOutput(initial), { initialProps: { initial: 'a' } })
    rerenderAt(hook, 'ab', 16)
    rerenderAt(hook, 'a completely different document', 32)
    expect(hook.result.current).toBe('a') // not immediate…
    nowMs += MARKDOWN_RENDER_INTERVAL_MS
    act(() => {
      vi.advanceTimersByTime(MARKDOWN_RENDER_INTERVAL_MS)
    })
    expect(hook.result.current).toBe('a completely different document') // …but ≤ interval
  })

  it('drops a pending emission when unmounted', () => {
    const hook = renderHook(({ initial }) => usePacedMarkdownOutput(initial), { initialProps: { initial: 'a' } })
    rerenderAt(hook, 'ab', 16)
    hook.unmount()
    expect(() => {
      nowMs += MARKDOWN_RENDER_INTERVAL_MS
      act(() => {
        vi.advanceTimersByTime(MARKDOWN_RENDER_INTERVAL_MS)
      })
    }).not.toThrow()
  })
})
