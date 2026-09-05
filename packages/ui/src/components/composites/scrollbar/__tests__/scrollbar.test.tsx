// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Scrollbar from '../index'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Scrollbar', () => {
  it('keeps the scrollbar visible when auto hiding is disabled', () => {
    vi.useFakeTimers()

    render(
      <Scrollbar autoHideScrollbar={false} data-testid="scrollbar">
        Content
      </Scrollbar>
    )

    const scrollbar = screen.getByTestId('scrollbar')

    // scrollbar visibility is a maintained visual contract for callers that need a discoverable position indicator.
    expect(scrollbar).toHaveStyle({ scrollbarColor: 'var(--scrollbar-thumb) transparent' })
    expect(scrollbar).toHaveClass('[&::-webkit-scrollbar-thumb]:bg-[var(--scrollbar-thumb)]')

    fireEvent.scroll(scrollbar)
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(scrollbar).toHaveStyle({ scrollbarColor: 'var(--scrollbar-thumb) transparent' })
    expect(scrollbar).toHaveClass('[&::-webkit-scrollbar-thumb]:bg-[var(--scrollbar-thumb)]')
  })

  it('auto hides the scrollbar by default after scrolling stops', () => {
    vi.useFakeTimers()

    render(<Scrollbar data-testid="scrollbar">Content</Scrollbar>)

    const scrollbar = screen.getByTestId('scrollbar')
    expect(scrollbar).toHaveStyle({ scrollbarColor: 'transparent transparent' })

    fireEvent.scroll(scrollbar)
    expect(scrollbar).toHaveStyle({ scrollbarColor: 'var(--scrollbar-thumb) transparent' })

    act(() => {
      vi.advanceTimersByTime(1500)
    })

    expect(scrollbar).toHaveStyle({ scrollbarColor: 'transparent transparent' })
  })
})
