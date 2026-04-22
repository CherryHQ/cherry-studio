import type { Message } from '@renderer/types/newMessage'
import type { CherryUIMessage } from '@shared/data/types/message'
import { render, screen, waitFor } from '@testing-library/react'
import { act, type ReactNode, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import V2ChatContent from '../V2ChatContent'

const mockUseChatWithHistory = vi.fn()
const mockUseTopicMessagesV2 = vi.fn()
let capturedOnSend: ((text: string) => Promise<void> | void) | undefined

vi.mock('@renderer/hooks/useChatContext', () => ({
  useChatContextProvider: vi.fn(() => ({ isMultiSelectMode: false })),
  ChatContextProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: (...args: unknown[]) => mockUseChatWithHistory(...args)
}))

vi.mock('@renderer/hooks/V2ChatContext', () => ({
  V2ChatOverridesProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/hooks/useTopicMessagesV2', () => ({
  useTopicMessagesV2: (...args: unknown[]) => mockUseTopicMessagesV2(...args)
}))

vi.mock('@renderer/services/ApiService', () => ({
  fetchMcpTools: vi.fn(async () => [])
}))

vi.mock('@renderer/utils/assistant', () => ({
  isPromptToolUse: vi.fn(() => false),
  isSupportedToolUse: vi.fn(() => false)
}))

vi.mock('../Inputbar/Inputbar', () => ({
  default: ({ onSend }: { onSend: (text: string) => Promise<void> | void }) => (
    (capturedOnSend = onSend),
    (
      <button type="button" onClick={() => onSend('hello')}>
        send
      </button>
    )
  )
}))

vi.mock('../Messages/Blocks', () => ({
  PartsProvider: ({ children }: { children: ReactNode }) => children,
  RefreshProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('../Messages/Messages', () => ({
  default: ({ messages }: { messages: Message[] }) => (
    <div data-testid="messages">{messages.map((message) => message.id).join(',')}</div>
  )
}))

vi.mock('../Messages/ExecutionStreamCollector', () => ({
  default: function ExecutionStreamCollectorMock({
    executionId,
    onMessagesChange
  }: {
    executionId: string
    onMessagesChange: (executionId: string, messages: CherryUIMessage[]) => void
  }) {
    useEffect(() => {
      onMessagesChange(executionId, [
        {
          id: `live-${executionId}`,
          role: 'assistant',
          parts: [{ type: 'text', text: `reply-${executionId}` }],
          metadata: { createdAt: '2026-01-02T00:00:00.000Z' }
        }
      ])
    }, [executionId, onMessagesChange])

    return null
  }
}))

vi.mock('@renderer/components/Popups/MultiSelectionPopup', () => ({
  default: () => null
}))

function createLegacyMessage(id: string, role: Message['role']): Message {
  return {
    id,
    role,
    assistantId: 'assistant-1',
    topicId: 'topic-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: role === 'assistant' ? 'success' : 'success',
    blocks: []
  } as Message
}

function createUiMessage(id: string, role: CherryUIMessage['role']): CherryUIMessage {
  return {
    id,
    role,
    parts: role === 'assistant' ? [{ type: 'text', text: `reply-${id}` }] : [{ type: 'text', text: `prompt-${id}` }],
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' }
  } as CherryUIMessage
}

describe('V2ChatContent', () => {
  const assistant = {
    id: 'assistant-1',
    name: 'Test Assistant',
    model: { id: 'gpt-4.1', provider: 'openai' },
    topics: [],
    type: 'assistant'
  } as any

  const topic = {
    id: 'topic-1',
    assistantId: 'assistant-1',
    name: 'Topic 1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: []
  } as any

  beforeEach(() => {
    mockUseTopicMessagesV2.mockReturnValue({
      uiMessages: [createUiMessage('history-user', 'user'), createUiMessage('history-assistant', 'assistant')],
      metadataMap: {
        'history-user': {
          parentId: null,
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        'history-assistant': {
          parentId: 'history-user',
          modelId: 'openai::gpt-4.1',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      },
      isLoading: false,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: 'branch-a'
    })

    mockUseChatWithHistory.mockReturnValue({
      adaptedMessages: [
        createLegacyMessage('history-user', 'user'),
        createLegacyMessage('history-assistant', 'assistant')
      ],
      partsMap: {},
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      status: 'ready',
      error: null,
      setMessages: vi.fn(),
      streamingUIMessages: [createUiMessage('history-user', 'user'), createUiMessage('history-assistant', 'assistant')],
      activeExecutionIds: [],
      initialMessages: [createUiMessage('history-user', 'user'), createUiMessage('history-assistant', 'assistant')],
      prepareNextAssistantId: vi.fn()
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    capturedOnSend = undefined
  })

  it('sends the active branch node as parentAnchorId', async () => {
    const sendMessage = vi.fn()
    mockUseChatWithHistory.mockReturnValue({
      adaptedMessages: [
        createLegacyMessage('history-user', 'user'),
        createLegacyMessage('history-assistant', 'assistant')
      ],
      partsMap: {},
      sendMessage,
      regenerate: vi.fn(),
      stop: vi.fn(),
      status: 'ready',
      error: null,
      setMessages: vi.fn(),
      streamingUIMessages: [createUiMessage('history-user', 'user'), createUiMessage('history-assistant', 'assistant')],
      activeExecutionIds: [],
      initialMessages: [createUiMessage('history-user', 'user'), createUiMessage('history-assistant', 'assistant')],
      prepareNextAssistantId: vi.fn()
    })

    render(<V2ChatContent assistant={assistant} topic={topic} setActiveTopic={vi.fn()} mainHeight="100px" />)

    await act(async () => {
      await capturedOnSend?.('hello')
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        { text: 'hello' },
        expect.objectContaining({
          body: expect.objectContaining({
            parentAnchorId: 'branch-a'
          })
        })
      )
    })
  })

  it('merges live execution messages into rendered messages', async () => {
    mockUseChatWithHistory.mockReturnValue({
      adaptedMessages: [
        createLegacyMessage('history-user', 'user'),
        createLegacyMessage('history-assistant', 'assistant')
      ],
      partsMap: {},
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      status: 'streaming',
      error: null,
      setMessages: vi.fn(),
      streamingUIMessages: [createUiMessage('history-user', 'user')],
      activeExecutionIds: ['openai::gpt-4o'],
      initialMessages: [createUiMessage('history-user', 'user'), createUiMessage('history-assistant', 'assistant')],
      prepareNextAssistantId: vi.fn()
    })

    render(<V2ChatContent assistant={assistant} topic={topic} setActiveTopic={vi.fn()} mainHeight="100px" />)

    await waitFor(() => {
      expect(screen.getByTestId('messages')).toHaveTextContent('history-user,history-assistant,live-openai::gpt-4o')
    })
  })
})
