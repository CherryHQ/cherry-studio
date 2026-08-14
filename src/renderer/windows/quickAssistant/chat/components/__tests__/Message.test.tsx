import '@testing-library/jest-dom/vitest'

import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MessageItem from '../Message'

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [key === 'chat.message.font' ? 'system' : 14]
}))

vi.mock('@renderer/components/chat/messages/frame/MessageContent', () => ({
  default: ({ message }: { message: MessageListItem }) => <span>{message.id}</span>
}))

const createMessage = (role: 'user' | 'assistant'): MessageListItem =>
  ({
    id: `${role}-message`,
    role,
    createdAt: new Date().toISOString(),
    blocks: []
  }) as unknown as MessageListItem

describe('QuickAssistant MessageItem', () => {
  it('renders user messages as right-aligned content-sized bubbles', () => {
    const { container } = render(<MessageItem message={createMessage('user')} total={1} route="chat" />)

    expect(container.querySelector('.message')).toHaveClass('message-user', 'items-end')
    expect(container.querySelector('.message-content-container')).toHaveClass(
      'rounded-[10px]',
      'bg-muted',
      'px-4',
      'py-2.5'
    )
    expect(container.querySelector('.message-content-container')).not.toHaveClass('w-full')
  })

  it('keeps assistant messages full-width without the user bubble styling', () => {
    const { container } = render(<MessageItem message={createMessage('assistant')} total={1} route="chat" />)

    expect(container.querySelector('.message')).toHaveClass('message-assistant')
    expect(container.querySelector('.message')).not.toHaveClass('items-end')
    expect(container.querySelector('.message-content-container')).toHaveClass('w-full')
    expect(container.querySelector('.message-content-container')).not.toHaveClass('bg-muted', 'px-4', 'py-2.5')
  })
})
