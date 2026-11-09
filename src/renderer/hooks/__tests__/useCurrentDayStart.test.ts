import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCurrentDayStart } from '../useCurrentDayStart'

const renderCountedHook = () => {
  let renders = 0
  const view = renderHook(() => {
    renders += 1
    return useCurrentDayStart()
  })
  return { ...view, getRenders: () => renders }
}

describe('useCurrentDayStart', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 7, 23, 58))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not re-render on checks within the same day', () => {
    const { getRenders } = renderCountedHook()
    const rendersAfterMount = getRenders()

    act(() => {
      vi.advanceTimersByTime(60_000)
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(getRenders()).toBe(rendersAfterMount)
  })

  it('moves to the new day from the periodic check', () => {
    const { result } = renderCountedHook()

    act(() => {
      vi.advanceTimersByTime(3 * 60_000)
    })

    expect(result.current).toBe(new Date(2026, 0, 8).getTime())
  })

  it('moves to the new day as soon as the window regains focus', () => {
    const { result } = renderCountedHook()

    vi.setSystemTime(new Date(2026, 0, 9, 8))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(result.current).toBe(new Date(2026, 0, 9).getTime())
  })

  it('moves to the new day as soon as the page becomes visible', () => {
    const { result } = renderCountedHook()

    vi.setSystemTime(new Date(2026, 0, 9, 8))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current).toBe(new Date(2026, 0, 9).getTime())
  })

  it('stops checking after unmount', () => {
    const { unmount } = renderCountedHook()

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
