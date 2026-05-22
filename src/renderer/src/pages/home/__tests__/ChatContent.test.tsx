import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ChatContent from '../ChatContent'

const mockUseChatWithHistory = vi.fn()
const mockUseTopicMessages = vi.fn()
const mockMessageListValue = vi.hoisted(() => ({ current: null as any }))
const mockEventEmit = vi.hoisted(() => vi.fn())
const mockRespondToolApproval = vi.hoisted(() => vi.fn())
let capturedOnSend:
  | ((text: string, options?: { userMessageParts?: CherryMessagePart[] }) => Promise<void> | void)
  | undefined

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: (...args: unknown[]) => mockUseChatWithHistory(...args)
}))

vi.mock('@renderer/hooks/ChatWriteContext', () => ({
  ChatWriteProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/hooks/useTopicMessages', () => ({
  useTopicMessages: (...args: unknown[]) => mockUseTopicMessages(...args)
}))

vi.mock('@renderer/hooks/useToolApprovalBridge', () => ({
  useToolApprovalBridge: () => mockRespondToolApproval
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    LOCATE_MESSAGE: 'LOCATE_MESSAGE'
  },
  EventEmitter: {
    emit: mockEventEmit
  }
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({
    overlay: {},
    liveAssistants: [],
    disposeOverlay: vi.fn(),
    reset: vi.fn()
  })
}))

vi.mock('@renderer/services/ApiService', () => ({
  fetchMcpTools: vi.fn(async () => [])
}))

vi.mock('@renderer/utils/assistant', () => ({
  isPromptToolUse: vi.fn(() => false),
  isSupportedToolUse: vi.fn(() => false)
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: {
      id: 'assistant-1',
      knowledgeBaseIds: [],
      settings: { enableWebSearch: false }
    },
    model: undefined,
    setModel: vi.fn()
  })
}))

vi.mock('@renderer/components/chat/composer/variants/ChatComposer', () => ({
  default: ({
    onSend,
    sendDisabled,
    useMentionedModelSelector
  }: {
    onSend: (text: string, options?: { userMessageParts?: CherryMessagePart[] }) => Promise<void> | void
    sendDisabled?: boolean
    useMentionedModelSelector?: boolean
  }) => (
    (capturedOnSend = onSend),
    (
      <button
        type="button"
        data-use-mentioned-model-selector={String(Boolean(useMentionedModelSelector))}
        disabled={sendDisabled}
        onClick={() => onSend('hello', { userMessageParts: [{ type: 'text', text: 'hello' } as CherryMessagePart] })}>
        send
      </button>
    )
  ),
  ChatHomeComposer: ({
    onSend,
    onTemporaryAssistantChange
  }: {
    onSend: (text: string, options?: { userMessageParts?: CherryMessagePart[] }) => Promise<void> | void
    onTemporaryAssistantChange?: (assistantId: string | null) => void | Promise<void>
  }) => {
    capturedOnSend = onSend
    return (
      <button
        type="button"
        data-testid="chat-home-composer"
        onClick={() => onTemporaryAssistantChange?.('assistant-2')}>
        home composer
      </button>
    )
  }
}))

vi.mock('@renderer/components/chat/composer/ComposerDockTransitionFrame', () => ({
  default: ({
    placement,
    main,
    composer,
    mainVisible
  }: {
    placement: string
    main: ReactNode
    composer: ReactNode
    mainVisible?: boolean
  }) => (
    <div data-testid="composer-dock-frame" data-placement={placement} data-main-visible={String(Boolean(mainVisible))}>
      <div data-testid="composer-dock-main">{main}</div>
      <div data-testid="composer-dock-composer">{composer}</div>
    </div>
  )
}))

vi.mock('@renderer/components/chat/messages/blocks', () => ({
  PartsProvider: ({ children }: { children: ReactNode }) => children,
  RefreshProvider: ({ children }: { children: ReactNode }) => children,
  TranslationOverlayProvider: ({ children }: { children: ReactNode }) => children,
  TranslationOverlaySetterProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  MessageListProvider: ({ value, children }: { value: unknown; children: ReactNode }) => {
    mockMessageListValue.current = value
    return children
  }
}))

vi.mock('../messages/homeMessageListAdapter', () => ({
  useHomeMessageListProviderValue: (params: {
    messages: CherryUIMessage[]
    partsByMessageId: Record<string, CherryMessagePart[]>
    isInitialLoading?: boolean
  }) => ({
    state: {
      messages: params.messages,
      partsByMessageId: params.partsByMessageId,
      isInitialLoading: params.isInitialLoading
    },
    actions: {},
    meta: {}
  })
}))

vi.mock('@renderer/components/chat/messages/MessageList', () => ({
  default: () =>
    mockMessageListValue.current?.state.isInitialLoading ? (
      <div data-testid="message-list-loading" />
    ) : (
      <div data-testid="messages">
        {mockMessageListValue.current?.state.messages.map((message: CherryUIMessage) => message.id).join(',')}
      </div>
    )
}))

function createUiMessage(id: string, role: CherryUIMessage['role']): CherryUIMessage {
  return {
    id,
    role,
    parts: role === 'assistant' ? [{ type: 'text', text: `reply-${id}` }] : [{ type: 'text', text: `prompt-${id}` }],
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' }
  } as CherryUIMessage
}

describe('ChatContent', () => {
  const topic = {
    id: 'topic-1',
    assistantId: 'assistant-1',
    name: 'Topic 1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: []
  } as any

  const originalApi = window.api as any

  beforeEach(() => {
    const streamOpen = vi.fn().mockResolvedValue({ mode: 'started', userMessageId: 'user-1' })
    mockUseTopicMessages.mockReturnValue({
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
      status: 'ready',
      setMessages: vi.fn(),
      activeExecutions: []
    })

    ;(window as any).api = {
      ...originalApi,
      ai: {
        ...originalApi?.ai,
        streamOpen,
        onStreamDone: vi.fn(() => () => {}),
        onStreamError: vi.fn(() => () => {})
      }
    }
  })

  afterEach(() => {
    ;(window as any).api = originalApi
    vi.clearAllMocks()
    capturedOnSend = undefined
    mockMessageListValue.current = null
    mockRespondToolApproval.mockReset()
    mockEventEmit.mockReset()
  })

  it('opens a stream against the active branch node', async () => {
    const sendMessage = vi.fn()
    mockUseChatWithHistory.mockReturnValue({
      sendMessage,
      regenerate: vi.fn(),
      stop: vi.fn(),
      error: null,
      setMessages: vi.fn(),
      activeExecutions: []
    })

    render(<ChatContent topic={topic} mainHeight="100px" />)

    await act(async () => {
      await capturedOnSend?.('hello', { userMessageParts: [{ type: 'text', text: 'hello' } as CherryMessagePart] })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(window.api.ai.streamOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'submit-message',
          topicId: 'topic-1',
          parentAnchorId: 'branch-a',
          userMessageParts: [{ type: 'text', text: 'hello' }]
        })
      )
    })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('keeps a message cache key without fetching history for freshly leased temporary topics', () => {
    render(<ChatContent topic={topic} mainHeight="100px" onPersistTemporaryTopic={vi.fn()} />)

    expect(mockUseTopicMessages).toHaveBeenCalledWith('topic-1', { fetchOnMount: false })
  })

  it('fails before stream open when temporary topic handoff returns no persisted topic', async () => {
    mockUseTopicMessages.mockReturnValue({
      uiMessages: [],
      siblingsMap: {},
      isLoading: false,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: null,
      loadOlder: vi.fn(),
      hasOlder: false,
      mutate: vi.fn().mockResolvedValue(undefined)
    })
    const persistTemporaryTopic = vi.fn().mockResolvedValue(null)

    render(<ChatContent topic={topic} mainHeight="100px" onPersistTemporaryTopic={persistTemporaryTopic} />)

    await act(async () => {
      await expect(
        capturedOnSend?.('hello', { userMessageParts: [{ type: 'text', text: 'hello' } as CherryMessagePart] })
      ).rejects.toThrow('Temporary topic handoff failed before stream open')
    })

    expect(persistTemporaryTopic).toHaveBeenCalledWith('hello')
    expect(window.api.ai.streamOpen).not.toHaveBeenCalled()
  })

  it('uses a local rollback instead of revalidating DataApi when a fresh temporary topic send fails', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined)
    mockUseTopicMessages.mockReturnValue({
      uiMessages: [],
      siblingsMap: {},
      isLoading: false,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: null,
      loadOlder: vi.fn(),
      hasOlder: false,
      mutate
    })
    ;(window.api.ai.streamOpen as any).mockRejectedValueOnce(new Error('open failed'))
    const persistTemporaryTopic = vi.fn().mockResolvedValue({
      assistantId: 'assistant-1',
      id: 'topic-1',
      topic,
      topicId: 'topic-1',
      type: 'assistant'
    })

    render(<ChatContent topic={topic} mainHeight="100px" onPersistTemporaryTopic={persistTemporaryTopic} />)

    await act(async () => {
      await expect(
        capturedOnSend?.('hello', { userMessageParts: [{ type: 'text', text: 'hello' } as CherryMessagePart] })
      ).rejects.toThrow('open failed')
    })

    expect(mutate).toHaveBeenCalledWith([{ items: [], nextCursor: undefined, activeNodeId: null, assistantId: null }], {
      revalidate: false
    })
  })

  it('keeps the composer visible while topic history is loading', () => {
    mockUseTopicMessages.mockReturnValue({
      uiMessages: [createUiMessage('stale-user', 'user'), createUiMessage('stale-assistant', 'assistant')],
      siblingsMap: {},
      isLoading: true,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: null,
      loadOlder: vi.fn(),
      hasOlder: false,
      mutate: vi.fn().mockResolvedValue(undefined)
    })

    render(<ChatContent topic={topic} mainHeight="100px" />)

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'docked')
    expect(screen.getByTestId('message-list-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('messages')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'send' })).toHaveAttribute('data-use-mentioned-model-selector', 'true')
  })

  it('centers the home composer for a fresh empty temporary topic and routes assistant changes', () => {
    const onTemporaryAssistantChange = vi.fn()
    mockUseTopicMessages.mockReturnValue({
      uiMessages: [],
      siblingsMap: {},
      isLoading: false,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: null,
      loadOlder: vi.fn(),
      hasOlder: false,
      mutate: vi.fn().mockResolvedValue(undefined)
    })
    mockUseChatWithHistory.mockReturnValue({
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      error: null,
      status: 'ready',
      setMessages: vi.fn(),
      activeExecutions: []
    })

    render(
      <ChatContent
        topic={topic}
        mainHeight="100px"
        onPersistTemporaryTopic={vi.fn()}
        onTemporaryAssistantChange={onTemporaryAssistantChange}
        renderFrame={({ main, bottomComposer }) => (
          <>
            <div data-testid="frame-main">{main}</div>
            <div data-testid="frame-bottom">{bottomComposer}</div>
          </>
        )}
      />
    )

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'home')
    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-main-visible', 'false')
    expect(screen.getByTestId('frame-main')).toHaveTextContent('home composer')
    expect(screen.getByTestId('frame-bottom')).toBeEmptyDOMElement()

    fireEvent.click(screen.getByTestId('chat-home-composer'))

    expect(onTemporaryAssistantChange).toHaveBeenCalledWith('assistant-2')
  })

  it('renders only uiMessages in the list (execution overlay affects parts, not the list itself)', async () => {
    // Core architectural contract post-refactor: the rendered list is a
    // projection of `uiMessages` (DB truth). Overlay from an active
    // Execution overlay updates `partsByMessageId` but never adds entries
    // to the message list — any streaming bubble must already exist in
    // uiMessages as a pending placeholder (Main reserves before streaming).
    mockUseTopicMessages.mockReturnValue({
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
      activeExecutions: [{ executionId: 'pending-placeholder', anchorMessageId: 'pending-placeholder' }] as never
    })

    render(<ChatContent topic={topic} mainHeight="100px" />)

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
    mockUseTopicMessages.mockReturnValue({
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
      activeExecutions: [{ executionId: 'gemini-new-pending', anchorMessageId: 'gemini-new-pending' }] as never
    })

    render(<ChatContent topic={topic} mainHeight="100px" />)

    await waitFor(() => {
      expect(screen.getByTestId('messages')).toHaveTextContent('u-1,gemini-old,kimi,claude,gemini-new-pending')
    })
  })

  it('replaces the normal inputbar with the shared permission composer and uses the chat approval bridge', async () => {
    const approvalPart = {
      type: 'tool-CustomTool',
      toolName: 'CustomTool',
      toolCallId: 'call-1',
      state: 'approval-requested',
      input: { command: 'pnpm test' },
      approval: { id: 'approval-1' },
      callProviderMetadata: {
        'claude-code': {
          rawInput: { command: 'pnpm test' },
          parentToolCallId: null
        }
      }
    } as unknown as CherryMessagePart
    const approvalMessage = {
      id: 'assistant-approval',
      role: 'assistant',
      parts: [approvalPart],
      metadata: {
        createdAt: '2026-01-01T00:00:01.000Z',
        status: 'pending'
      }
    } as CherryUIMessage

    mockUseTopicMessages.mockReturnValue({
      uiMessages: [createUiMessage('history-user', 'user'), approvalMessage],
      siblingsMap: {},
      isLoading: false,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: 'branch-a',
      loadOlder: vi.fn(),
      hasOlder: false,
      mutate: vi.fn().mockResolvedValue(undefined)
    })

    render(<ChatContent topic={topic} mainHeight="100px" />)

    expect(screen.queryByRole('button', { name: 'send' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /allow|允许|agent\.toolPermission\.button\.allow/i }))

    await waitFor(() => expect(mockRespondToolApproval).toHaveBeenCalledTimes(1))
    expect(mockRespondToolApproval).toHaveBeenCalledWith({
      match: expect.objectContaining({
        approvalId: 'approval-1',
        messageId: 'assistant-approval',
        toolCallId: 'call-1'
      }),
      approved: true
    })
  })

  it('keeps pending locate requests while target history is still loading', () => {
    const loadOlder = vi.fn()
    const onLocateMessageHandled = vi.fn()
    mockUseTopicMessages.mockReturnValue({
      uiMessages: [createUiMessage('history-user', 'user')],
      siblingsMap: {},
      isLoading: true,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: 'branch-a',
      loadOlder,
      hasOlder: true,
      mutate: vi.fn().mockResolvedValue(undefined)
    })

    render(
      <ChatContent
        topic={topic}
        mainHeight="100px"
        locateMessageId="target-message"
        onLocateMessageHandled={onLocateMessageHandled}
      />
    )

    expect(loadOlder).not.toHaveBeenCalled()
    expect(onLocateMessageHandled).not.toHaveBeenCalled()
    expect(mockEventEmit).not.toHaveBeenCalled()
  })

  it('loads older history for pending locate and clears it only after the target appears', async () => {
    const loadOlder = vi.fn()
    const onLocateMessageHandled = vi.fn()
    mockUseTopicMessages.mockReturnValue({
      uiMessages: [createUiMessage('history-user', 'user')],
      siblingsMap: {},
      isLoading: false,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: 'branch-a',
      loadOlder,
      hasOlder: true,
      mutate: vi.fn().mockResolvedValue(undefined)
    })

    const { rerender } = render(
      <ChatContent
        topic={topic}
        mainHeight="100px"
        locateMessageId="target-message"
        onLocateMessageHandled={onLocateMessageHandled}
      />
    )

    await waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(1))
    expect(onLocateMessageHandled).not.toHaveBeenCalled()

    mockUseTopicMessages.mockReturnValue({
      uiMessages: [createUiMessage('history-user', 'user'), createUiMessage('target-message', 'assistant')],
      siblingsMap: {},
      isLoading: false,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: 'target-message',
      loadOlder,
      hasOlder: false,
      mutate: vi.fn().mockResolvedValue(undefined)
    })
    rerender(
      <ChatContent
        topic={topic}
        mainHeight="100px"
        locateMessageId="target-message"
        onLocateMessageHandled={onLocateMessageHandled}
      />
    )

    await waitFor(() => {
      expect(mockEventEmit).toHaveBeenCalledWith('LOCATE_MESSAGE:target-message', true)
      expect(onLocateMessageHandled).toHaveBeenCalledTimes(1)
    })
  })
})
