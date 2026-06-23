import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ConversationCenterState from '../ConversationCenterState'

vi.mock('../../messages/layout/MessageListLoading', () => ({
  MessageListInitialLoading: () => <div data-testid="center-loading" />
}))

describe('ConversationCenterState', () => {
  it('renders loading content for loading state', () => {
    render(<ConversationCenterState state="loading" />)

    expect(screen.getByTestId('center-loading')).toBeInTheDocument()
  })

  it('renders a neutral full-height placeholder for empty state', () => {
    const { container } = render(<ConversationCenterState state="empty" />)

    expect(container.firstElementChild).toHaveClass('h-full')
  })
})
