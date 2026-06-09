import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ConversationCenterState from '../ConversationCenterState'

describe('ConversationCenterState', () => {
  it('renders loading content for loading state', () => {
    const { container } = render(<ConversationCenterState state="loading" />)

    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders a neutral full-height placeholder for empty state', () => {
    const { container } = render(<ConversationCenterState state="empty" />)

    expect(container.firstElementChild).toHaveClass('h-full')
  })
})
