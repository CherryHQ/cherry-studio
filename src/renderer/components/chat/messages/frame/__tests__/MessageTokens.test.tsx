import type { Topic } from '@renderer/types'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem, type MessageListProviderValue } from '../../types'
import MessageTokens from '../MessageTokens'

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

const topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  name: 'Topic',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: []
} as Topic

function createMessage(role: 'user' | 'assistant', stats: MessageListItem['stats']): MessageListItem {
  return {
    id: `${role}-message-1`,
    role,
    topicId: topic.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success',
    stats
  }
}

function renderWithProvider(message: MessageListItem) {
  const value: MessageListProviderValue = {
    state: {
      topic,
      messages: [message],
      partsByMessageId: {
        [message.id]: []
      },
      hasOlder: false,
      messageNavigation: 'none',
      estimateSize: 0,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: defaultMessageRenderConfig,
      selection: {
        enabled: false,
        isMultiSelectMode: false,
        selectedMessageIds: []
      },
      translationLanguages: []
    },
    actions: {
      locateMessage: vi.fn()
    },
    meta: {
      selectionLayer: false
    }
  }

  return render(
    <MessageListProvider value={value}>
      <MessageTokens message={message} />
    </MessageListProvider>
  )
}

describe('MessageTokens', () => {
  it('formats user message token usage in K units', () => {
    const { container } = renderWithProvider(createMessage('user', { totalTokens: 42 }))

    expect(container.querySelector('.message-tokens')?.textContent).toBe('Tokens: 0.0K')
  })

  it('formats assistant message token usage in K units', () => {
    const { container } = renderWithProvider(
      createMessage('assistant', {
        promptTokens: 1234,
        completionTokens: 2048,
        totalTokens: 3282
      })
    )

    expect(container.querySelector('.message-tokens')?.textContent).toBe('Tokens:3.3K↑1.2K↓2.0K')
  })
})
