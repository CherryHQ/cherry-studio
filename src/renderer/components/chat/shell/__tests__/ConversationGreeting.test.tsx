import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ConversationGreeting } from '../ConversationGreeting'

describe('ConversationGreeting', () => {
  it('renders starter prompts inside the centered greeting content', () => {
    render(<ConversationGreeting title="Welcome" suggestions={<div>Starter prompts</div>} />)

    expect(screen.getByTestId('conversation-greeting')).toHaveClass('min-h-0', 'overflow-y-auto')
    expect(screen.getByTestId('conversation-greeting-content')).toContainElement(screen.getByText('Starter prompts'))
  })
})
