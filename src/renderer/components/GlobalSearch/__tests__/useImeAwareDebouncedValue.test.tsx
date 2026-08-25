// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import type { CompositionEvent } from 'react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GLOBAL_SEARCH_QUERY_DEBOUNCE_MS, useImeAwareDebouncedValue } from '../useImeAwareDebouncedValue'

function compositionEndEvent(value: string) {
  return { currentTarget: { value } } as unknown as CompositionEvent<HTMLInputElement>
}

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

    // Candidate confirmation commits the final text without extra delay. The
    // controlled value is still the intermediate ('ni') here because some
    // engines emit `compositionend` before the final change event; the hook
    // must read the final DOM value carried by the event instead of it.
    act(() => {
      result.current.compositionHandlers.onCompositionEnd(compositionEndEvent('你好'))
    })
    expect(result.current.committedValue).toBe('你好')
  })

  it('resumes normal debouncing after a composition ends', () => {
    const { result, rerender } = renderValueHook('')

    act(() => {
      result.current.compositionHandlers.onCompositionStart()
    })
    rerender({ value: 'ni' })
    act(() => {
      result.current.compositionHandlers.onCompositionEnd(compositionEndEvent('你好'))
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

describe('useImeAwareDebouncedValue with a real input harness', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Mirrors the panel wiring: a controlled input whose onChange feeds the
  // hook's trimmed value, so real DOM event ordering is exercised.
  function SearchHarness() {
    const [raw, setRaw] = React.useState('')
    const { committedValue, compositionHandlers } = useImeAwareDebouncedValue(raw.trim())

    return (
      <>
        <input
          aria-label="harness search"
          value={raw}
          {...compositionHandlers}
          onChange={(event) => setRaw(event.target.value)}
        />
        <output data-testid="committed">{committedValue}</output>
      </>
    )
  }

  function setDomValue(element: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(element, value)
  }

  it('commits the final DOM text when compositionend precedes the final change event', () => {
    render(<SearchHarness />)
    const input = screen.getByLabelText('harness search') as HTMLInputElement

    fireEvent.compositionStart(input)
    // Romanization intermediates flow through onChange while composing and
    // are never committed to the backend.
    fireEvent.change(input, { target: { value: 'ni' } })
    act(() => {
      vi.advanceTimersByTime(GLOBAL_SEARCH_QUERY_DEBOUNCE_MS * 2)
    })
    expect(screen.getByTestId('committed')).toHaveTextContent('')

    // The engine writes the final candidates into the input and emits
    // `compositionend` BEFORE React processes the matching change event, so
    // the controlled value is still the intermediate. The hook must read the
    // event's own target (the final DOM value) instead of committing 'ni'.
    setDomValue(input, '你好')
    fireEvent.compositionEnd(input)
    expect(screen.getByTestId('committed')).toHaveTextContent('你好')

    // The trailing change event lands afterwards and stays consistent.
    fireEvent.change(input, { target: { value: '你好' } })
    expect(screen.getByTestId('committed')).toHaveTextContent('你好')
  })
})
