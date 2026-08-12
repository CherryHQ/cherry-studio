import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDebouncedRender } from '../hooks/useDebouncedRender'

describe('useDebouncedRender', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('renders only the latest content after the debounce delay', async () => {
    const renderFunction = vi.fn(async () => {})
    const { result } = renderHook(() => useDebouncedRender('', renderFunction, { debounceDelay: 100 }))
    const container = document.createElement('div')
    result.current.containerRef.current = container

    act(() => {
      result.current.triggerRender('first')
      result.current.triggerRender('second')
    })

    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(renderFunction).toHaveBeenCalledOnce()
    expect(renderFunction).toHaveBeenCalledWith('second', container)
    expect(result.current.isLoading).toBe(false)
  })

  it('reports rendering errors and clears them after a successful retry', async () => {
    const renderFunction = vi.fn().mockRejectedValueOnce(new Error('Invalid diagram')).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useDebouncedRender('', renderFunction, { debounceDelay: 100 }))
    result.current.containerRef.current = document.createElement('div')

    act(() => {
      result.current.triggerRender('broken')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(result.current.error).toBe('Invalid diagram')
    expect(result.current.isLoading).toBe(false)

    act(() => {
      result.current.triggerRender('fixed')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(result.current.error).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('cancels pending renders', async () => {
    const renderFunction = vi.fn(async () => {})
    const { result } = renderHook(() => useDebouncedRender('', renderFunction, { debounceDelay: 100 }))
    result.current.containerRef.current = document.createElement('div')

    act(() => {
      result.current.triggerRender('diagram')
      result.current.cancelRender()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(renderFunction).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
  })
})
