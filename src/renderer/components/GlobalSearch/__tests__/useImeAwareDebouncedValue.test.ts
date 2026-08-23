// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GLOBAL_SEARCH_QUERY_DEBOUNCE_MS, useImeAwareDebouncedValue } from '../useImeAwareDebouncedValue'

function renderValueHook(initialValue: string) {
  return renderHook((props: { value: string }) => useImeAwareDebouncedValue(props.value), {
    initialProps: { value: initialValue }
  })
}

describe('useImeAwareDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('collapses keystroke bursts into a single trailing commit', () => {
    const { result, rerender } = renderValueHook('')

    rerender({ value: 'h' })
    rerender({ value: 'he' })
    rerender({ value: 'hel' })

    act(() => {
      vi.advanceTimersByTime(GLOBAL_SEARCH_QUERY_DEBOUNCE_MS - 1)
    })
    expect(result.current.committedValue).toBe('')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.committedValue).toBe('hel')
  })

  it('commits an empty query synchronously without waiting for the debounce window', () => {
    const { result, rerender } = renderValueHook('query')

    act(() => {
      vi.advanceTimersByTime(GLOBAL_SEARCH_QUERY_DEBOUNCE_MS)
    })
    expect(result.current.committedValue).toBe('query')

    rerender({ value: '' })
    expect(result.current.committedValue).toBe('')
  })

  it('holds the committed value during IME composition and flushes on compositionend', () => {
    const { result, rerender } = renderValueHook('')

    act(() => {
      result.current.compositionHandlers.onCompositionStart()
    })

    // Romanization intermediates never reach the search backend.
    rerender({ value: 'n' })
    act(() => {
      vi.advanceTimersByTime(GLOBAL_SEARCH_QUERY_DEBOUNCE_MS * 2)
    })
    expect(result.current.committedValue).toBe('')

    rerender({ value: 'ni' })
    act(() => {
      vi.advanceTimersByTime(GLOBAL_SEARCH_QUERY_DEBOUNCE_MS * 2)
    })
    expect(result.current.committedValue).toBe('')

    // Candidate confirmation commits the final text without extra delay.
    act(() => {
      result.current.compositionHandlers.onCompositionEnd()
    })
    expect(result.current.committedValue).toBe('ni')
  })

  it('resumes normal debouncing after a composition ends', () => {
    const { result, rerender } = renderValueHook('')

    act(() => {
      result.current.compositionHandlers.onCompositionStart()
    })
    rerender({ value: '你好' })
    act(() => {
      result.current.compositionHandlers.onCompositionEnd()
    })
    expect(result.current.committedValue).toBe('你好')

    rerender({ value: '你好！' })
    act(() => {
      vi.advanceTimersByTime(GLOBAL_SEARCH_QUERY_DEBOUNCE_MS - 1)
    })
    expect(result.current.committedValue).toBe('你好')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.committedValue).toBe('你好！')
  })
})
