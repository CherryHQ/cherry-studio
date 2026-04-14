import type { Message } from '@renderer/types/newMessage'
import type { CherryUIMessage } from '@shared/data/types/message'
import { fireEvent, render, screen } from '@testing-library/react'
import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import V2ChatContent from '../V2ChatContent'

const mockUseChat = vi.fn()
const mockUseTopicMessagesV2 = vi.fn()
const mockEnsureChatTopicPersisted = vi.fn()

vi.mock('@ai-sdk/react', () => ({
  useChat: (...args: unknown[]) => mockUseChat(...args)
}))

vi.mock('@renderer/hooks/useChatContext', () => ({
  useChatContextProvider: vi.fn(() => ({ isMultiSelectMode: false })),
  ChatContextProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/hooks/useMessageOperations', () => ({
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

vi.mock('../chatPersistence', () => ({
  ensureChatTopicPersisted: (...args: unknown[]) => mockEnsureChatTopicPersisted(...args)
}))

vi.mock('../Inputbar/Inputbar', () => ({
  default: ({ onSend }: { onSend: (text: string) => Promise<void> | void }) => (
    <button onClick={() => onSend('hello')}>send</button>
  )
}))

vi.mock('../Messages/Blocks', () => ({
  PartsProvider: ({ children }: { children: ReactNode }) => children,
  RefreshProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('../Messages/Messages', () => ({
  default: () => <div>messages</div>
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
    parts: role === 'assistant' ? [{ type: 'text', text: `reply-${id}` }] : [{ type: 'text', text: `prompt-${id}` }]
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

  let streamDoneHandler: ((data: { topicId: string; status: 'success' | 'paused' }) => void) | undefined

  beforeEach(() => {
    mockEnsureChatTopicPersisted.mockReset().mockResolvedValue(undefined)

    ;(window as unknown as { api: any }).api = {
      ai: {
        onStreamDone: vi.fn((cb: typeof streamDoneHandler) => {
          streamDoneHandler = cb
          return () => {
            if (streamDoneHandler === cb) {
              streamDoneHandler = undefined
            }
          }
        })
      }
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    streamDoneHandler = undefined
  })

  it('sends the active branch node as parentAnchorId', async () => {
    const sendMessage = vi.fn()

    mockUseTopicMessagesV2.mockReturnValue({
      adaptedMessages: [
        createLegacyMessage('root-user', 'user'),
        createLegacyMessage('branch-a', 'assistant'),
        createLegacyMessage('branch-b-sibling', 'assistant')
      ],
      partsMap: {},
      isLoading: false,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: 'branch-a'
    })

    mockUseChat.mockReturnValue({
      messages: [],
      setMessages: vi.fn(),
      stop: vi.fn(),
      status: 'ready',
      error: null,
      sendMessage,
      regenerate: vi.fn()
    })

    render(<V2ChatContent assistant={assistant} topic={topic} setActiveTopic={vi.fn()} mainHeight="100px" />)

    await act(async () => {
      fireEvent.click(screen.getByText('send'))
      await Promise.resolve()
    })

    expect(sendMessage).toHaveBeenCalledOnce()

    expect(sendMessage).toHaveBeenCalledWith(
      { text: 'hello' },
      expect.objectContaining({
        body: expect.objectContaining({
          parentAnchorId: 'branch-a'
        })
      })
    )
  })

  it('waits for refreshed history to catch up before clearing live messages', async () => {
    vi.useFakeTimers()

    const refresh = vi
      .fn()
      .mockResolvedValueOnce([
        createUiMessage('history-user', 'user'),
        createUiMessage('history-assistant', 'assistant')
      ])
      .mockResolvedValueOnce([
        createUiMessage('history-user', 'user'),
        createUiMessage('history-assistant', 'assistant'),
        createUiMessage('persisted-user', 'user'),
        createUiMessage('persisted-assistant', 'assistant')
      ])
    const setMessages = vi.fn()

    mockUseTopicMessagesV2.mockReturnValue({
      adaptedMessages: [
        createLegacyMessage('history-user', 'user'),
        createLegacyMessage('history-assistant', 'assistant')
      ],
      partsMap: {},
      isLoading: false,
      refresh,
      activeNodeId: 'history-assistant'
    })

    mockUseChat.mockReturnValue({
      messages: [createUiMessage('live-user', 'user'), createUiMessage('live-assistant', 'assistant')],
      setMessages,
      stop: vi.fn(),
      status: 'ready',
      error: null,
      sendMessage: vi.fn(),
      regenerate: vi.fn()
    })

    render(<V2ChatContent assistant={assistant} topic={topic} setActiveTopic={vi.fn()} mainHeight="100px" />)

    await act(async () => {
      streamDoneHandler?.({ topicId: 'topic-1', status: 'success' })
      await Promise.resolve()
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(setMessages).not.toHaveBeenCalledWith([])

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(refresh).toHaveBeenCalledTimes(2)
    expect(setMessages).toHaveBeenCalledWith([])
  })
})
