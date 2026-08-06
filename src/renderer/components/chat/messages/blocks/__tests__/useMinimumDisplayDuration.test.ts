// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMinimumDisplayDuration } from '../useMinimumDisplayDuration'

interface Candidate {
  key: string
  label: string
}

const getCandidateKey = (candidate: Candidate) => candidate.key

describe('useMinimumDisplayDuration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps same-key data visible while waiting for a new key without resetting the duration', async () => {
    const { result, rerender } = renderHook(
      ({ value }) =>
        useMinimumDisplayDuration(value, {
          enabled: true,
          getKey: getCandidateKey,
          minimumDurationMs: 1000
        }),
      { initialProps: { value: { key: 'A', label: 'A0' } } }
    )

    await act(() => vi.advanceTimersByTime(400))
    rerender({ value: { key: 'A', label: 'A1' } })
    expect(result.current.label).toBe('A1')

    await act(() => vi.advanceTimersByTime(100))
    rerender({ value: { key: 'B', label: 'B' } })
    expect(result.current.label).toBe('A1')

    await act(() => vi.advanceTimersByTime(499))
    expect(result.current.label).toBe('A1')

    await act(() => vi.advanceTimersByTime(1))
    expect(result.current.label).toBe('B')
  })

  it('does not render again when only the payload for the current key changes', () => {
    let renderCount = 0
    const { result, rerender } = renderHook(
      ({ value }) => {
        renderCount += 1
        return useMinimumDisplayDuration(value, {
          enabled: true,
          getKey: getCandidateKey,
          minimumDurationMs: 1000
        })
      },
      { initialProps: { value: { key: 'A', label: 'A0' } } }
    )

    expect(renderCount).toBe(1)

    rerender({ value: { key: 'A', label: 'A1' } })

    expect(result.current.label).toBe('A1')
    // Rendering once for the prop change is the performance contract; the hook must not mirror it into state.
    expect(renderCount).toBe(2)
  })
})
