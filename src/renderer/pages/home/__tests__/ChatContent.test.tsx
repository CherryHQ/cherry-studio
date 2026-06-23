import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { mockUseInvalidateCache, mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor } from '@testing-library/react'
import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ChatContent from '../ChatContent'

const mockUseChatWithHistory = vi.fn()
const mockUseTopicMessages = vi.fn()
const mockMessageListValue = vi.hoisted(() => ({ current: null as any }))
const mockChatWriteValue = vi.hoisted(() => ({ current: null as any }))
const mockEventEmit = vi.hoisted(() => vi.fn())
const mockExecutionOverlay = vi.hoisted(() => ({ current: null as any }))
const mockUseExecutionOverlay = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => unknown>(() => mockExecutionOverlay.current)
)
const mockInvalidateCache = vi.fn<(keys?: string | string[] | boolean) => Promise<void>>(async () => undefined)
let capturedOnSend:
  | ((text: string, options?: { userMessageParts?: CherryMessagePart[] }) => Promise<void> | void)
  | undefined

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: (...args: unknown[]) => mockUseChatWithHistory(...args)
}))

vi.mock('@renderer/hooks/chat/ChatWriteContext', () => ({
  ChatWriteProvider: ({ value, children }: { value: unknown; children: ReactNode }) => {
    mockChatWriteValue.current = value
    return children
  }
}))

vi.mock('@renderer/hooks/useTopicMessages', () => ({
  useTopicMessages: (...args: unknown[]) => mockUseTopicMessages(...args)
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
  useExecutionOverlay: (...args: unknown[]) => mockUseExecutionOverlay(...args)
}))

vi.mock('@renderer/services/ApiService', () => ({
  fetchMcpTools: vi.fn(async () => [])
}))

vi.mock('@renderer/utils/assistant', () => ({
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
    onDraftAssistantChange
  }: {
    onSend: (text: string, options?: { userMessageParts?: CherryMessagePart[] }) => Promise<void> | void
    onDraftAssistantChange?: (assistantId: string | null) => void | Promise<void>
  }) => {
    capturedOnSend = onSend
    return (
      <button type="button" data-testid="chat-home-composer" onClick={() => onDraftAssistantChange?.('assistant-2')}>
        home composer
      </button>
    )
  },
  ChatPlacementComposer: ({
    isHome,
    onSend,
    sendDisabled,
    onDraftAssistantChange
  }: {
    isHome: boolean
    onSend: (text: string, options?: { userMessageParts?: CherryMessagePart[] }) => Promise<void> | void
    sendDisabled?: boolean
    onDraftAssistantChange?: (assistantId: string | null) => void | Promise<void>
  }) => {
    capturedOnSend = onSend
    if (isHome) {
      return (
        <button type="button" data-testid="chat-home-composer" onClick={() => onDraftAssistantChange?.('assistant-2')}>
          home composer
        </button>
      )
    }

    return (
      <button
        type="button"
        data-use-mentioned-model-selector="true"
        disabled={sendDisabled}
        onClick={() => onSend('hello', { userMessageParts: [{ type: 'text', text: 'hello' } as CherryMessagePart] })}>
        send
      </button>
    )
  }
}))

vi.mock('@renderer/components/chat/composer/ConversationComposerStage', () => ({
  default: ({
    placement,
    main,
    composer,
    homeWelcomeText
  }: {
    placement: string
    main: ReactNode
    composer: ReactNode
    homeWelcomeText?: string
  }) => (
    <div
      data-testid="composer-dock-frame"
      data-placement={placement}
      data-main-visible={String(placement === 'docked')}>
      <div data-testid="composer-dock-home-header">{placement === 'home' ? homeWelcomeText : null}</div>
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
    mockUseInvalidateCache.mockReturnValue(mockInvalidateCache)
    mockUseMutation.mockImplementation((method: string) => ({
      trigger: vi.fn(async () => {
        switch (method) {
          case 'POST':
            return { id: 'new_item', created: true }
          case 'PUT':
          case 'PATCH':
            return { id: 'updated_item', updated: true }
          case 'DELETE':
            return { deleted: true, deletedIds: [] }
          default:
            return { success: true }
        }
      }),
      isLoading: false,
      error: undefined
    }))
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
    mockExecutionOverlay.current = {
      overlay: {},
      liveAssistants: [],
      disposeOverlay: vi.fn(),
      reset: vi.fn()
    }
    mockUseExecutionOverlay.mockImplementation(() => mockExecutionOverlay.current)

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
    mockChatWriteValue.current = null
    mockEventEmit.mockReset()
    mockUseExecutionOverlay.mockReset()
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

    render(<ChatContent topic={topic} />)

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

  it('uses a branch draft anchor for the next send and clears it after stream open', async () => {
    const clearBranchDraft = vi.fn()
    const getBranchDraftAnchorId = vi.fn(() => 'assistant-old')

    render(
      <ChatContent topic={topic} clearBranchDraft={clearBranchDraft} getBranchDraftAnchorId={getBranchDraftAnchorId} />
    )

    await act(async () => {
      await capturedOnSend?.('hello', { userMessageParts: [{ type: 'text', text: 'hello' } as CherryMessagePart] })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(window.api.ai.streamOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          parentAnchorId: 'assistant-old',
          topicId: 'topic-1'
        })
      )
    })
    expect(getBranchDraftAnchorId).toHaveBeenCalled()
    expect(clearBranchDraft).toHaveBeenCalledTimes(1)
  })

  it('keeps a branch draft anchor when stream open fails', async () => {
    const clearBranchDraft = vi.fn()
    ;(window.api.ai.streamOpen as any).mockRejectedValueOnce(new Error('open failed'))

    render(
      <ChatContent topic={topic} clearBranchDraft={clearBranchDraft} getBranchDraftAnchorId={() => 'assistant-old'} />
    )

    await act(async () => {
      await expect(
        capturedOnSend?.('hello', { userMessageParts: [{ type: 'text', text: 'hello' } as CherryMessagePart] })
      ).rejects.toThrow('open failed')
    })

    expect(clearBranchDraft).not.toHaveBeenCalled()
  })

  it('resend opens a regenerate stream and seeds reserved messages without waiting for stream terminal', async () => {
    const historyUser = createUiMessage('history-user', 'user')
    const historyAssistant = {
      ...createUiMessage('history-assistant', 'assistant'),
      metadata: { parentId: 'history-user', createdAt: '2026-01-01T00:00:01.000Z' }
    } as CherryUIMessage
    const reservedAssistant = {
      id: 'reserved-assistant',
      role: 'assistant',
      parts: [],
      metadata: {
        createdAt: '2026-01-01T00:00:03.000Z',
        modelId: 'provider::model-a',
        parentId: 'history-user',
        status: 'pending'
      }
    } as CherryUIMessage
    const regenerate = vi.fn().mockResolvedValue(undefined)

    ;(window.api.ai.streamOpen as any).mockResolvedValueOnce({
      mode: 'started',
      reservedMessages: [reservedAssistant]
    })
    mockUseTopicMessages.mockReturnValue({
      uiMessages: [historyUser, historyAssistant],
      siblingsMap: {},
      isLoading: false,
      refresh: vi.fn().mockResolvedValue([]),
      activeNodeId: 'history-assistant',
      loadOlder: vi.fn(),
      hasOlder: false,
      mutate: vi.fn().mockResolvedValue(undefined)
    })
    mockUseChatWithHistory.mockReturnValue({
      sendMessage: vi.fn(),
      regenerate,
      stop: vi.fn(),
      error: null,
      status: 'ready',
      setMessages: vi.fn(),
      activeExecutions: []
    })

    render(<ChatContent topic={topic} />)

    await act(async () => {
      await mockChatWriteValue.current?.resend('history-user')
    })

    expect(window.api.ai.streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'regenerate-message',
        topicId: 'topic-1',
        parentAnchorId: 'history-user'
      })
    )
    expect(regenerate).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mockUseExecutionOverlay).toHaveBeenLastCalledWith(
        'topic-1',
        [{ executionId: 'provider::model-a', anchorMessageId: 'reserved-assistant' }],
        expect.any(Array),
        expect.any(Object)
      )
    })
  })

  it('refreshes topic metadata after stream open so time-grouped sidebars can reorder', async () => {
    render(<ChatContent topic={topic} />)

    await act(async () => {
      await capturedOnSend?.('hello', { userMessageParts: [{ type: 'text', text: 'hello' } as CherryMessagePart] })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockInvalidateCache).toHaveBeenCalledWith(['/topics', '/topics/topic-1'])
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

    render(<ChatContent topic={topic} />)

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'docked')
    expect(screen.getByTestId('message-list-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('messages')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'send' })).toHaveAttribute('data-use-mentioned-model-selector', 'true')
  })

  it('keeps an empty real topic in docked composer mode', () => {
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

    render(<ChatContent topic={topic} />)

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'docked')
    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-main-visible', 'true')
    expect(screen.getByTestId('composer-dock-composer')).toHaveTextContent('send')
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

    render(<ChatContent topic={topic} />)

    // List reflects uiMessages exactly — no extra `live-*` entry appended.
    await waitFor(() => {
      expect(screen.getByTestId('messages')).toHaveTextContent('history-user,history-assistant,pending-placeholder')
    })
  })

  it('streams branch live state from reserved messages and live assistant snapshots before topic cache updates', async () => {
    const onBranchLiveStateChange = vi.fn()
    const reservedUser = {
      id: 'reserved-user',
      role: 'user',
      parts: [{ type: 'text', text: 'live prompt' }],
      metadata: {
        createdAt: '2026-01-01T00:00:01.000Z',
        parentId: 'branch-a',
        status: 'success'
      }
    } as CherryUIMessage
    const reservedAssistant = {
      id: 'reserved-assistant',
      role: 'assistant',
      parts: [],
      metadata: {
        createdAt: '2026-01-01T00:00:02.000Z',
        modelId: 'provider::model',
        parentId: 'reserved-user',
        status: 'pending'
      }
    } as CherryUIMessage
    const liveAssistant = {
      id: 'reserved-assistant',
      role: 'assistant',
      parts: [{ type: 'text', text: 'partial stream preview' }]
    } as CherryUIMessage

    ;(window.api.ai.streamOpen as any).mockResolvedValueOnce({
      mode: 'started',
      userMessageId: 'reserved-user',
      reservedMessages: [reservedUser, reservedAssistant]
    })

    const view = render(<ChatContent topic={topic} onBranchLiveStateChange={onBranchLiveStateChange} />)

    await act(async () => {
      await capturedOnSend?.('live prompt', {
        userMessageParts: [{ type: 'text', text: 'live prompt' } as CherryMessagePart]
      })
    })

    await waitFor(() => {
      expect(mockUseExecutionOverlay).toHaveBeenLastCalledWith(
        'topic-1',
        [{ executionId: 'provider::model', anchorMessageId: 'reserved-assistant' }],
        expect.any(Array),
        expect.any(Object)
      )
    })
    await waitFor(() => {
      expect(onBranchLiveStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          activeNodeId: 'reserved-assistant',
          nodes: expect.arrayContaining([
            expect.objectContaining({ id: 'reserved-user', preview: 'live prompt' }),
            expect.objectContaining({ id: 'reserved-assistant', status: 'pending' })
          ])
        })
      )
    })

    mockExecutionOverlay.current = {
      overlay: { 'reserved-assistant': liveAssistant.parts as CherryMessagePart[] },
      liveAssistants: [liveAssistant],
      disposeOverlay: vi.fn(),
      reset: vi.fn()
    }
    mockUseExecutionOverlay.mockImplementation(() => mockExecutionOverlay.current)
    view.rerender(<ChatContent topic={topic} onBranchLiveStateChange={onBranchLiveStateChange} />)

    await waitFor(() => {
      expect(onBranchLiveStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              id: 'reserved-assistant',
              parentId: 'reserved-user',
              preview: 'partial stream preview',
              status: 'pending'
            })
          ])
        })
      )
    })
    expect(screen.getByTestId('messages')).toHaveTextContent('history-user,history-assistant')
  })

  it('clears branch live state when runtime live producers disappear', async () => {
    const onBranchLiveStateChange = vi.fn()
    const liveAssistant = {
      id: 'reserved-assistant',
      role: 'assistant',
      parts: [{ type: 'text', text: 'final stream text' }],
      metadata: {
        createdAt: '2026-01-01T00:00:02.000Z',
        modelId: 'provider::model',
        parentId: 'reserved-user',
        status: 'success'
      }
    } as CherryUIMessage

    mockUseChatWithHistory.mockReturnValue({
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      error: null,
      status: 'ready',
      setMessages: vi.fn(),
      activeExecutions: [{ executionId: 'provider::model', anchorMessageId: 'reserved-assistant' }]
    })
    mockExecutionOverlay.current = {
      overlay: {},
      liveAssistants: [liveAssistant],
      disposeOverlay: vi.fn(),
      reset: vi.fn()
    }

    const view = render(<ChatContent topic={topic} onBranchLiveStateChange={onBranchLiveStateChange} />)

    await waitFor(() => {
      expect(onBranchLiveStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              id: 'reserved-assistant',
              preview: 'final stream text',
              status: 'pending'
            })
          ])
        })
      )
    })

    onBranchLiveStateChange.mockClear()
    mockUseChatWithHistory.mockReturnValue({
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      error: null,
      status: 'ready',
      setMessages: vi.fn(),
      activeExecutions: []
    })
    mockExecutionOverlay.current = {
      overlay: {},
      liveAssistants: [],
      disposeOverlay: vi.fn(),
      reset: vi.fn()
    }

    view.rerender(<ChatContent topic={topic} onBranchLiveStateChange={onBranchLiveStateChange} />)

    await waitFor(() => {
      expect(onBranchLiveStateChange).toHaveBeenLastCalledWith(null)
    })
  })

  it('adds the forked user sibling to branch live state before refreshed tree data arrives', async () => {
    const onBranchLiveStateChange = vi.fn()
    const editedParts = [{ type: 'text', text: 'edited branch prompt' } as CherryMessagePart]
    const historyUser = {
      ...createUiMessage('history-user', 'user'),
      metadata: { parentId: 'branch-a', createdAt: '2026-01-01T00:00:00.000Z' }
    } as CherryUIMessage
    const historyAssistant = {
      ...createUiMessage('history-assistant', 'assistant'),
      metadata: { parentId: 'history-user', status: 'success', createdAt: '2026-01-01T00:00:01.000Z' }
    } as CherryUIMessage
    const createSiblingTrigger = vi.fn().mockResolvedValue({
      id: 'forked-user',
      topicId: 'topic-1',
      parentId: 'branch-a',
      role: 'user',
      data: { parts: editedParts },
      searchableText: '',
      status: 'success',
      siblingsGroupId: 17,
      modelId: null,
      modelSnapshot: null,
      traceId: null,
      stats: null,
      createdAt: '2026-01-01T00:00:03.000Z',
      updatedAt: '2026-01-01T00:00:03.000Z'
    })
    const refresh = vi.fn().mockResolvedValue([
      historyUser,
      historyAssistant,
      {
        id: 'forked-user',
        role: 'user',
        parts: editedParts,
        metadata: {
          parentId: 'branch-a',
          siblingsGroupId: 17,
          status: 'success',
          createdAt: '2026-01-01T00:00:03.000Z'
        }
      } as CherryUIMessage
    ])
    const reservedAssistant = {
      id: 'forked-assistant',
      role: 'assistant',
      parts: [],
      metadata: {
        parentId: 'forked-user',
        modelId: 'forked-exec',
        status: 'pending',
        createdAt: '2026-01-01T00:00:04.000Z'
      }
    } as CherryUIMessage
    const setMessages = vi.fn()
    const regenerate = vi.fn().mockResolvedValue(undefined)
    ;(window.api.ai.streamOpen as any).mockResolvedValueOnce({
      mode: 'started',
      reservedMessages: [reservedAssistant]
    })

    mockUseMutation.mockImplementation((method: string, path: string) => ({
      trigger: method === 'POST' && path === '/messages/:id/siblings' ? createSiblingTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))
    mockUseTopicMessages.mockReturnValue({
      uiMessages: [historyUser, historyAssistant],
      siblingsMap: {},
      isLoading: false,
      refresh,
      activeNodeId: 'branch-a',
      loadOlder: vi.fn(),
      hasOlder: false,
      mutate: vi.fn().mockResolvedValue(undefined)
    })
    mockUseChatWithHistory.mockReturnValue({
      sendMessage: vi.fn(),
      regenerate,
      stop: vi.fn(),
      error: null,
      status: 'ready',
      setMessages,
      activeExecutions: [{ executionId: 'forked-exec', anchorMessageId: 'forked-assistant' }] as never
    })

    render(<ChatContent topic={topic} onBranchLiveStateChange={onBranchLiveStateChange} />)

    await act(async () => {
      await mockChatWriteValue.current?.forkAndResend('history-user', editedParts)
    })

    expect(createSiblingTrigger).toHaveBeenCalledWith({
      params: { id: 'history-user' },
      body: { parts: editedParts }
    })
    expect(refresh).toHaveBeenCalled()
    expect(setMessages).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'forked-user' })]))
    expect(window.api.ai.streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'regenerate-message',
        topicId: 'topic-1',
        parentAnchorId: 'forked-user'
      })
    )
    expect(regenerate).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(onBranchLiveStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          activeNodeId: 'forked-assistant',
          nodes: expect.arrayContaining([
            expect.objectContaining({
              id: 'forked-user',
              parentId: 'branch-a',
              role: 'user',
              preview: 'edited branch prompt',
              status: 'success',
              siblingsGroupId: 17
            }),
            expect.objectContaining({
              id: 'forked-assistant',
              parentId: 'forked-user',
              role: 'assistant',
              status: 'pending'
            })
          ])
        })
      )
    })

    const overlayCall = mockUseExecutionOverlay.mock.calls.at(-1)
    expect(overlayCall).toBeDefined()
    const finish = (overlayCall![3] as any).onFinish as (
      executionId: string,
      event: { message: CherryUIMessage; isAbort: boolean; isError: boolean }
    ) => void

    act(() => {
      finish('forked-exec', {
        message: {
          id: 'forked-assistant',
          role: 'assistant',
          parts: [{ type: 'text', text: 'final answer' }] as CherryMessagePart[],
          metadata: { parentId: 'forked-user', status: 'success' }
        } as CherryUIMessage,
        isAbort: false,
        isError: false
      })
    })

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(2)
      expect(onBranchLiveStateChange).toHaveBeenLastCalledWith(null)
    })
  })

  it('preserves direct multi-model replies when resending an edited user message', async () => {
    const editedParts = [{ type: 'text', text: 'edited multi-model prompt' } as CherryMessagePart]
    const historyUser = {
      ...createUiMessage('history-user', 'user'),
      metadata: { parentId: 'branch-a', createdAt: '2026-01-01T00:00:00.000Z' }
    } as CherryUIMessage
    const firstModelReply = {
      ...createUiMessage('reply-model-a', 'assistant'),
      metadata: {
        parentId: 'history-user',
        modelId: 'provider-a::model-a',
        status: 'success',
        createdAt: '2026-01-01T00:00:01.000Z'
      }
    } as CherryUIMessage
    const secondModelReply = {
      ...createUiMessage('reply-model-b', 'assistant'),
      metadata: {
        parentId: 'history-user',
        modelId: 'legacy-model-b',
        modelSnapshot: { id: 'model-b', name: 'Model B', provider: 'provider-b' },
        status: 'success',
        createdAt: '2026-01-01T00:00:02.000Z'
      }
    } as CherryUIMessage
    const followUpUser = {
      ...createUiMessage('follow-up-user', 'user'),
      metadata: { parentId: 'reply-model-a', createdAt: '2026-01-01T00:00:03.000Z' }
    } as CherryUIMessage
    const laterModelReply = {
      ...createUiMessage('later-reply-model-c', 'assistant'),
      metadata: {
        parentId: 'follow-up-user',
        modelId: 'provider-c::model-c',
        status: 'success',
        createdAt: '2026-01-01T00:00:04.000Z'
      }
    } as CherryUIMessage
    const createSiblingTrigger = vi.fn().mockResolvedValue({
      id: 'forked-user',
      topicId: 'topic-1',
      parentId: 'branch-a',
      role: 'user',
      data: { parts: editedParts },
      searchableText: '',
      status: 'success',
      siblingsGroupId: 19,
      modelId: null,
      modelSnapshot: null,
      traceId: null,
      stats: null,
      createdAt: '2026-01-01T00:00:05.000Z',
      updatedAt: '2026-01-01T00:00:05.000Z'
    })
    const refresh = vi.fn().mockResolvedValue([])

    ;(window.api.ai.streamOpen as any).mockResolvedValueOnce({ mode: 'started', reservedMessages: [] })
    mockUseMutation.mockImplementation((method: string, path: string) => ({
      trigger: method === 'POST' && path === '/messages/:id/siblings' ? createSiblingTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))
    mockUseTopicMessages.mockReturnValue({
      uiMessages: [historyUser, firstModelReply, secondModelReply, followUpUser, laterModelReply],
      siblingsMap: {},
      isLoading: false,
      refresh,
      activeNodeId: 'later-reply-model-c',
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

    render(<ChatContent topic={topic} />)

    await act(async () => {
      await mockChatWriteValue.current?.forkAndResend('history-user', editedParts)
    })

    expect(window.api.ai.streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'regenerate-message',
        topicId: 'topic-1',
        parentAnchorId: 'forked-user',
        mentionedModelIds: ['provider-a::model-a', 'provider-b::model-b']
      })
    )
  })

  it('resends an edited root user message by creating a root sibling', async () => {
    const editedParts = [{ type: 'text', text: 'edited root prompt' } as CherryMessagePart]
    const createSiblingTrigger = vi.fn().mockResolvedValue({
      id: 'forked-root-user',
      topicId: 'topic-1',
      parentId: null,
      role: 'user',
      data: { parts: editedParts },
      searchableText: '',
      status: 'success',
      siblingsGroupId: 23,
      modelId: null,
      modelSnapshot: null,
      traceId: null,
      stats: null,
      createdAt: '2026-01-01T00:00:03.000Z',
      updatedAt: '2026-01-01T00:00:03.000Z'
    })
    const setMessages = vi.fn()
    const regenerate = vi.fn().mockResolvedValue(undefined)
    const rootUser = {
      ...createUiMessage('root-user', 'user'),
      metadata: { parentId: null, createdAt: '2026-01-01T00:00:00.000Z' }
    } as CherryUIMessage
    const rootAssistant = {
      ...createUiMessage('root-assistant', 'assistant'),
      metadata: {
        parentId: 'root-user',
        modelId: 'provider::root-model',
        status: 'success',
        createdAt: '2026-01-01T00:00:01.000Z'
      }
    } as CherryUIMessage

    const refresh = vi.fn().mockResolvedValue([
      rootUser,
      rootAssistant,
      {
        id: 'forked-root-user',
        role: 'user',
        parts: editedParts,
        metadata: {
          parentId: null,
          siblingsGroupId: 23,
          status: 'success',
          createdAt: '2026-01-01T00:00:03.000Z'
        }
      } as CherryUIMessage
    ])
    ;(window.api.ai.streamOpen as any).mockResolvedValueOnce({
      mode: 'started',
      reservedMessages: [
        {
          id: 'forked-root-assistant',
          role: 'assistant',
          parts: [],
          metadata: {
            parentId: 'forked-root-user',
            modelId: 'provider::root-model',
            status: 'pending',
            createdAt: '2026-01-01T00:00:04.000Z'
          }
        } as CherryUIMessage
      ]
    })

    mockUseMutation.mockImplementation((method: string, path: string) => ({
      trigger: method === 'POST' && path === '/messages/:id/siblings' ? createSiblingTrigger : vi.fn(),
      isLoading: false,
      error: undefined
    }))
    mockUseTopicMessages.mockReturnValue({
      uiMessages: [rootUser, rootAssistant],
      siblingsMap: {},
      isLoading: false,
      refresh,
      activeNodeId: 'root-assistant',
      loadOlder: vi.fn(),
      hasOlder: false,
      mutate: vi.fn().mockResolvedValue(undefined)
    })
    mockUseChatWithHistory.mockReturnValue({
      sendMessage: vi.fn(),
      regenerate,
      stop: vi.fn(),
      error: null,
      status: 'ready',
      setMessages,
      activeExecutions: []
    })

    render(<ChatContent topic={topic} />)

    await act(async () => {
      await mockChatWriteValue.current?.forkAndResend('root-user', editedParts)
    })

    expect(createSiblingTrigger).toHaveBeenCalledWith({
      params: { id: 'root-user' },
      body: { parts: editedParts }
    })
    expect(refresh).toHaveBeenCalled()
    expect(setMessages).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'forked-root-user', parts: editedParts })])
    )
    expect(window.api.ai.streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'regenerate-message',
        topicId: 'topic-1',
        parentAnchorId: 'forked-root-user'
      })
    )
    expect((window.api.ai.streamOpen as any).mock.calls.at(-1)?.[0]).not.toHaveProperty('mentionedModelIds')
    expect(regenerate).not.toHaveBeenCalled()
  })

  it('configures message writes to refresh the branch tree cache', () => {
    render(<ChatContent topic={topic} />)

    expect(mockUseMutation).toHaveBeenCalledWith(
      'PATCH',
      '/messages/:id',
      expect.objectContaining({
        refresh: ['/topics/topic-1/messages', '/topics/topic-1/tree']
      })
    )
    expect(mockUseMutation).toHaveBeenCalledWith(
      'POST',
      '/messages/:id/siblings',
      expect.objectContaining({
        refresh: ['/topics/topic-1/messages', '/topics/topic-1/tree']
      })
    )
  })

  it('clears branch live state after all multi-model executions finish in the same tick', async () => {
    const onBranchLiveStateChange = vi.fn()
    const reservedUser = {
      id: 'reserved-user',
      role: 'user',
      parts: [{ type: 'text', text: 'multi prompt' }],
      metadata: {
        createdAt: '2026-01-01T00:00:01.000Z',
        parentId: 'branch-a',
        status: 'success'
      }
    } as CherryUIMessage
    const reservedAssistantA = {
      id: 'reserved-assistant-a',
      role: 'assistant',
      parts: [],
      metadata: {
        createdAt: '2026-01-01T00:00:02.000Z',
        modelId: 'provider::model-a',
        parentId: 'reserved-user',
        siblingsGroupId: 8,
        status: 'pending'
      }
    } as CherryUIMessage
    const reservedAssistantB = {
      id: 'reserved-assistant-b',
      role: 'assistant',
      parts: [],
      metadata: {
        createdAt: '2026-01-01T00:00:03.000Z',
        modelId: 'provider::model-b',
        parentId: 'reserved-user',
        siblingsGroupId: 8,
        status: 'pending'
      }
    } as CherryUIMessage

    ;(window.api.ai.streamOpen as any).mockResolvedValueOnce({
      mode: 'started',
      userMessageId: 'reserved-user',
      reservedMessages: [reservedUser, reservedAssistantA, reservedAssistantB]
    })
    const refresh = vi.fn().mockResolvedValue([])
    mockUseTopicMessages.mockReturnValue({
      uiMessages: [createUiMessage('history-user', 'user'), createUiMessage('history-assistant', 'assistant')],
      siblingsMap: {},
      isLoading: false,
      refresh,
      activeNodeId: 'branch-a',
      loadOlder: vi.fn(),
      hasOlder: false,
      mutate: vi.fn().mockResolvedValue(undefined)
    })

    render(<ChatContent topic={topic} onBranchLiveStateChange={onBranchLiveStateChange} />)

    await act(async () => {
      await capturedOnSend?.('multi prompt', {
        userMessageParts: [{ type: 'text', text: 'multi prompt' } as CherryMessagePart]
      })
    })

    await waitFor(() => {
      expect(mockUseExecutionOverlay).toHaveBeenLastCalledWith(
        'topic-1',
        [
          { executionId: 'provider::model-a', anchorMessageId: 'reserved-assistant-a' },
          { executionId: 'provider::model-b', anchorMessageId: 'reserved-assistant-b' }
        ],
        expect.any(Array),
        expect.any(Object)
      )
    })

    const overlayCall = mockUseExecutionOverlay.mock.calls.at(-1)
    expect(overlayCall).toBeDefined()
    const finish = (overlayCall![3] as any).onFinish as (
      executionId: string,
      event: { message: CherryUIMessage; isAbort: boolean; isError: boolean }
    ) => void

    act(() => {
      finish('provider::model-a', {
        message: { ...reservedAssistantA, parts: [{ type: 'text', text: 'model a final' }] as CherryMessagePart[] },
        isAbort: false,
        isError: false
      })
      finish('provider::model-b', {
        message: { ...reservedAssistantB, parts: [{ type: 'text', text: 'model b final' }] as CherryMessagePart[] },
        isAbort: false,
        isError: false
      })
    })

    await waitFor(() => {
      expect(onBranchLiveStateChange).toHaveBeenLastCalledWith(null)
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

    render(<ChatContent topic={topic} />)

    await waitFor(() => {
      expect(screen.getByTestId('messages')).toHaveTextContent('u-1,gemini-old,kimi,claude,gemini-new-pending')
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
      <ChatContent topic={topic} locateMessageId="target-message" onLocateMessageHandled={onLocateMessageHandled} />
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
      <ChatContent topic={topic} locateMessageId="target-message" onLocateMessageHandled={onLocateMessageHandled} />
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
      <ChatContent topic={topic} locateMessageId="target-message" onLocateMessageHandled={onLocateMessageHandled} />
    )

    await waitFor(() => {
      expect(mockEventEmit).toHaveBeenCalledWith('LOCATE_MESSAGE:target-message', true)
      expect(onLocateMessageHandled).toHaveBeenCalledTimes(1)
    })
  })
})
