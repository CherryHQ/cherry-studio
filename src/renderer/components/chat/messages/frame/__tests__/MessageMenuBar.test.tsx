import type { Topic } from '@renderer/types'
import { render } from '@testing-library/react'
import type React from 'react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { MessageListProvider } from '../../MessageListProvider'
import {
  defaultMessageMenuConfig,
  defaultMessageRenderConfig,
  type MessageListItem,
  type MessageListProviderValue
} from '../../types'

vi.mock('../MessageMenuBarToolbar', () => ({
  MessageMenuBarToolbarAction: ({ action }: { action: { id: string } }) => (
    <button className="message-action-button" type="button">
      {action.id}
    </button>
  )
}))

vi.mock('@renderer/utils', () => ({
  classNames: (...values: unknown[]) => values.filter(Boolean).join(' ')
}))

vi.mock('@renderer/utils/export', () => ({
  messageToMarkdown: vi.fn(),
  messageToPlainText: vi.fn()
}))

vi.mock('@renderer/utils/image', () => ({
  captureScrollableAsBlob: vi.fn(),
  captureScrollableAsDataURL: vi.fn()
}))

vi.mock('@renderer/utils/messageUtils/partsHelpers', () => ({
  getTranslationFromParts: () => undefined,
  getTextFromParts: () => 'hello',
  hasTextParts: () => true,
  hasTranslationParts: () => false
}))

vi.mock('@renderer/services/MessagesService', () => ({
  getMessageTitle: vi.fn()
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const { default: MessageMenuBar } = await import('../MessageMenuBar')

const topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  name: 'Topic',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: []
} as Topic

const assistantMessage = {
  id: 'message-1',
  role: 'assistant',
  topicId: topic.id,
  parentId: 'message-0',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'success',
  stats: {
    promptTokens: 10,
    completionTokens: 32,
    totalTokens: 42
  }
} as MessageListItem

function renderWithProvider(children: ReactNode) {
  const value: MessageListProviderValue = {
    state: {
      topic,
      messages: [assistantMessage],
      partsByMessageId: {
        [assistantMessage.id]: []
      },
      hasOlder: false,
      messageNavigation: 'none',
      estimateSize: 0,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: {
        ...defaultMessageRenderConfig,
        messageStyle: 'bubble'
      },
      selection: {
        enabled: false,
        isMultiSelectMode: false,
        selectedMessageIds: []
      },
      menuConfig: defaultMessageMenuConfig,
      getMessageUiState: () => ({}),
      getMessageActivityState: () => ({
        isProcessing: false,
        isStreamTarget: false,
        isApprovalAnchor: false
      }),
      translationLanguages: []
    },
    actions: {
      copyText: vi.fn(),
      locateMessage: vi.fn()
    },
    meta: {
      selectionLayer: false
    }
  }

  return render(<MessageListProvider value={value}>{children}</MessageListProvider>)
}

describe('MessageMenuBar', () => {
  it('shows assistant token usage in the bubble footer toolbar', () => {
    const { container } = renderWithProvider(
      <MessageMenuBar
        message={assistantMessage}
        topic={topic}
        isLastMessage
        isAssistantMessage
        isProcessing={false}
        messageContainerRef={{ current: null } as unknown as React.RefObject<HTMLDivElement>}
      />
    )

    expect(container.querySelector('.message-tokens')?.textContent).toContain('Tokens:0.0K')
  })
})
