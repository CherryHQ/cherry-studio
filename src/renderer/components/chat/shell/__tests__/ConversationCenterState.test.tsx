import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ConversationCenterState from '../ConversationCenterState'

vi.mock('../../messages/layout/MessageListLoading', () => ({
  MessageListInitialLoading: () => <div data-testid="center-loading" />
}))

vi.mock('../ConversationStageCenter', () => ({
  default: ({ main, composer }: { main: ReactNode; composer: ReactNode }) => (
    <div>
      {main}
      {composer}
    </div>
  )
}))

describe('ConversationCenterState', () => {
  it('renders only the message loading structure for loading state', () => {
    render(<ConversationCenterState state="loading" />)

    expect(screen.getByTestId('center-loading')).toBeInTheDocument()
    expect(document.querySelector('[data-conversation-composer-loading]')).not.toBeInTheDocument()
  })
})
