import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTimer } from '../useTimer'

describe('useTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('releases completed timeouts instead of retaining every distinct key until unmount', () => {
    const { result } = renderHook(() => useTimer())
    const completed: number[] = []
    for (let index = 0; index < 100; index++) {
      result.current.setTimeoutTimer(`task-${index}`, () => completed.push(index), 10)
    }

    void act(() => vi.advanceTimersByTime(10))
    expect(completed).toHaveLength(100)

    // Expired registrations must not accumulate in subsequent resource cleanup.
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    result.current.clearAllTimeoutTimers()
    expect(clearTimeoutSpy).not.toHaveBeenCalled()
  })

  it('keeps a timeout scheduled by an expired callback cancellable by its key', () => {
    const { result } = renderHook(() => useTimer())
    const delivered: string[] = []
    result.current.setTimeoutTimer(
      'repeat',
      () => {
        delivered.push('first')
        result.current.setTimeoutTimer('repeat', () => delivered.push('second'), 10)
      },
      10
    )

    void act(() => vi.advanceTimersByTime(10))
    result.current.clearTimeoutTimer('repeat')
    void act(() => vi.advanceTimersByTime(10))

    expect(delivered).toEqual(['first'])
  })

  it('releases a completed timeout even when its callback throws', () => {
    const { result } = renderHook(() => useTimer())
    const error = new Error('callback failed')
    result.current.setTimeoutTimer(
      'failure',
      () => {
        throw error
      },
      10
    )

    expect(() => act(() => vi.advanceTimersByTime(10))).toThrow(error)

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    result.current.clearAllTimeoutTimers()
    expect(clearTimeoutSpy).not.toHaveBeenCalled()
  })

  it('cancels a replaced timeout and executes only the latest callback', () => {
    const { result } = renderHook(() => useTimer())
    const delivered: string[] = []
    result.current.setTimeoutTimer('task', () => delivered.push('obsolete'), 10)
    result.current.setTimeoutTimer('task', () => delivered.push('current'), 20)

    void act(() => vi.advanceTimersByTime(20))

    expect(delivered).toEqual(['current'])
  })

  it('cancels pending timeouts and intervals on unmount', () => {
    const { result, unmount } = renderHook(() => useTimer())
    const delivered: string[] = []
    result.current.setTimeoutTimer('task', () => delivered.push('timeout'), 10)
    result.current.setIntervalTimer('poll', () => delivered.push('interval'), 10)

    unmount()
    void act(() => vi.advanceTimersByTime(30))

    expect(delivered).toEqual([])
  })
})
