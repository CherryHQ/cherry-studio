import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ConversationGreeting } from '../ConversationGreeting'

describe('ConversationGreeting', () => {
  it('keeps the greeting and footer reachable in a short viewport', () => {
    render(<ConversationGreeting title="Welcome" footer={<div>Starter prompts</div>} />)

    // These classes are the layout contract that prevents the docked composer from covering overflow.
    expect(screen.getByTestId('conversation-greeting')).toHaveClass('min-h-0', 'overflow-y-auto')
    expect(screen.getByTestId('conversation-greeting-content')).toHaveClass('flex-auto', 'shrink-0')
  })
})
