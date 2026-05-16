import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MessageListInitialLoading } from '../MessageListLoading'

vi.mock('@renderer/components/Icons', () => ({
  LoadingIcon: () => <span data-testid="loading-icon" />
}))

describe('MessageListInitialLoading', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits before showing the loading indicator', () => {
    vi.useFakeTimers()

    render(<MessageListInitialLoading delayMs={300} />)

    expect(screen.queryByTestId('loading-icon')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(screen.queryByTestId('loading-icon')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByTestId('loading-icon')).toBeInTheDocument()
  })

  it('does not show the indicator after unmounting before the delay', () => {
    vi.useFakeTimers()

    const { unmount } = render(<MessageListInitialLoading delayMs={300} />)
    unmount()

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.queryByTestId('loading-icon')).not.toBeInTheDocument()
  })
})
