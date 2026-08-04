import { render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MessageListInitialLoading } from '../MessageListLoading'

describe('MessageListInitialLoading', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits briefly before showing the message skeleton', () => {
    vi.useFakeTimers()

    render(<MessageListInitialLoading delayMs={300} />)

    expect(document.querySelector('[data-message-list-loading-skeleton]')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(document.querySelector('[data-message-list-loading-skeleton]')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(document.querySelector('[data-message-list-loading-skeleton]')).toBeInTheDocument()
  })

  it('clears the pending skeleton timer on unmount', () => {
    vi.useFakeTimers()

    const { unmount } = render(<MessageListInitialLoading delayMs={300} />)
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
