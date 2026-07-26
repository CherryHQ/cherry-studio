import '@testing-library/jest-dom/vitest'

import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ChatWindow from '../ChatWindow'

vi.mock('../components/Messages', () => ({
  default: () => <div data-testid="quick-chat-messages" />
}))

describe('ChatWindow', () => {
  it('renders the message surface without a persisted assistant', () => {
    render(
      <ChatWindow
        route="chat"
        assistant={null}
        isOutputted={false}
        messages={[] as MessageListItem[]}
        partsByMessageId={{}}
      />
    )

    expect(screen.getByTestId('quick-chat-messages')).toBeInTheDocument()
  })
})
