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

function createUiMessage(id: string, role: CherryUIMessage['role']): CherryUIMessage {
  return {
    id,
    role,
    parts: role === 'assistant' ? [{ type: 'text', text: `reply-${id}` }] : [{ type: 'text', text: `prompt-${id}` }],
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' }
  } as CherryUIMessage
}

describe('V2ChatContent', () => {
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
      siblingsMap: {},
      isLoading: false,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: 'branch-a',
      loadOlder: vi.fn(),
      hasOlder: false,
      mutate: vi.fn().mockResolvedValue(undefined)
    })

    mockUseChatWithHistory.mockReturnValue({
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      error: null,
      setMessages: vi.fn(),
      activeExecutionIds: []
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    capturedOnSend = undefined
  })

  it('sends the active branch node as parentAnchorId', async () => {
    const sendMessage = vi.fn()
    mockUseChatWithHistory.mockReturnValue({
      sendMessage,
      regenerate: vi.fn(),
      stop: vi.fn(),
      error: null,
      setMessages: vi.fn(),
      activeExecutionIds: []
    })

    render(<V2ChatContent topic={topic} setActiveTopic={vi.fn()} mainHeight="100px" />)

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

  it('renders only uiMessages in the list (execution overlay affects parts, not the list itself)', async () => {
    // Core architectural contract post-refactor: the rendered list is a
    // projection of `uiMessages` (DB truth). Overlay from an active
    // ExecutionStreamCollector updates `partsMap` but never adds entries
    // to the message list — any streaming bubble must already exist in
    // uiMessages as a pending placeholder (Main reserves before streaming).
    mockUseTopicMessagesV2.mockReturnValue({
      uiMessages: [
        createUiMessage('history-user', 'user'),
        createUiMessage('history-assistant', 'assistant'),
        createUiMessage('pending-placeholder', 'assistant') // reserved by Main
      ],
      siblingsMap: {},
      isLoading: false,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: 'branch-a',
      loadOlder: vi.fn(),
      hasOlder: false,
      mutate: vi.fn().mockResolvedValue(undefined)
    })
    mockUseChatWithHistory.mockReturnValue({
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      error: null,
      setMessages: vi.fn(),
      activeExecutionIds: ['pending-placeholder'] as string[]
    })

    render(<V2ChatContent topic={topic} setActiveTopic={vi.fn()} mainHeight="100px" />)

    // List reflects uiMessages exactly — no extra `live-*` entry appended.
    await waitFor(() => {
      expect(screen.getByTestId('messages')).toHaveTextContent('history-user,history-assistant,pending-placeholder')
    })
  })

  it('regenerate within multi-model group keeps sibling bubbles in the list', async () => {
    // Core bug this refactor addresses. Four siblings share the same
    // parent user; one (gemini) is being regenerated (status=pending,
    // new DB placeholder). The other three (kimi, claude, original gemini)
    // stay SUCCESS. The list must contain all four.
    mockUseTopicMessagesV2.mockReturnValue({
      uiMessages: [
        createUiMessage('u-1', 'user'),
        createUiMessage('gemini-old', 'assistant'),
        createUiMessage('kimi', 'assistant'),
        createUiMessage('claude', 'assistant'),
        createUiMessage('gemini-new-pending', 'assistant')
      ],
      siblingsMap: {},
      isLoading: false,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: 'gemini-new-pending'
    })
    mockUseChatWithHistory.mockReturnValue({
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      error: null,
      setMessages: vi.fn(),
      activeExecutionIds: ['gemini-new-pending'] as string[]
    })

    render(<V2ChatContent topic={topic} setActiveTopic={vi.fn()} mainHeight="100px" />)

    await waitFor(() => {
      expect(screen.getByTestId('messages')).toHaveTextContent('u-1,gemini-old,kimi,claude,gemini-new-pending')
    })
  })
})
