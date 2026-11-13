import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MessageListInitialLoading } from '../MessageListLoading'

describe('MessageListInitialLoading', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the pending skeleton timer on unmount', () => {
    vi.useFakeTimers()

    const { unmount } = render(<MessageListInitialLoading delayMs={300} />)
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
