import type { Topic } from '@renderer/types/topic'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Chat from '../Chat'

const renderCounters = vi.hoisted(() => ({
  chatContent: 0,
  navbar: 0,
  eventEmit: vi.fn(),
  createAwaitingInputMessage: vi.fn().mockResolvedValue(undefined),
  setBranchLiveState: vi.fn()
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'chat.message.style') return ['message-style']

    return [undefined, vi.fn()]
  }
}))

vi.mock('@data/hooks/useDataApi', async () => {
  const { MockUseDataApi } = await import('@test-mocks/renderer/useDataApi')
  return {
    ...MockUseDataApi,
    useMutation: () => ({
      trigger: renderCounters.createAwaitingInputMessage,
      isLoading: false,
      error: undefined
    })
  }
})

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    FOCUS_CHAT_COMPOSER: 'FOCUS_CHAT_COMPOSER'
  },
  EventEmitter: {
    emit: renderCounters.eventEmit
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/chat/shell/ConversationShell', () => ({
  default: ({
    topBar,
    topRightTool,
    sidePanel,
    center,
    centerOverlay,
    overlay,
    rightPane
  }: {
    topBar?: ReactNode
    topRightTool?: ReactNode
    sidePanel?: ReactNode
    center: ReactNode
    centerOverlay?: ReactNode
    overlay?: ReactNode
    rightPane?: ReactNode
  }) => (
    <div>
      <div data-testid="chat-top-bar">{topBar}</div>
      <div data-testid="chat-top-right-tool">{topRightTool}</div>
      <div data-testid="chat-side-panel">{sidePanel}</div>
      <div>{center}</div>
      <div>{centerOverlay}</div>
      <div>{overlay}</div>
      <div data-testid="chat-right-pane">{rightPane}</div>
    </div>
  )
}))

vi.mock('@renderer/components/ContentSearch', () => ({
  ContentSearch: () => <div data-testid="content-search" />
}))

vi.mock('@renderer/components/popups/PromptPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  useTopicMutations: () => ({ updateTopic: vi.fn() })
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn()
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../components/ChatNavbar', () => ({
  default: () => {
    renderCounters.navbar += 1
    return <div data-testid="chat-navbar" />
  }
}))

vi.mock('../components/TopicRightPane', () => {
  const TopicRightPane = {
    Scope: ({ children }: PropsWithChildren) => <div>{children}</div>,
    Shortcuts: () => <button type="button">branch shortcuts</button>,
    Viewport: ({
      onLocateMessage,
      onStartBranchDraft
    }: {
      onLocateMessage?: (messageId: string) => void
      onStartBranchDraft?: (messageId: string) => void | Promise<void>
    }) => (
      <div data-testid="topic-right-pane-viewport">
        <button type="button" onClick={() => onLocateMessage?.('message-x')}>
          locate branch message
        </button>
        <button type="button" onClick={() => void onStartBranchDraft?.('assistant-old')}>
          start branch draft
        </button>
      </div>
    )
  }

  return {
    TopicRightPane,
    useTopicBranchLiveStateSetter: () => renderCounters.setBranchLiveState
  }
})

vi.mock('../ChatContent', () => ({
  default: ({
    onBranchLiveStateChange,
    onLocateMessageHandled,
    onOpenCitationsPanel,
    locateMessageId
  }: {
    onBranchLiveStateChange?: (state: unknown) => void
    onLocateMessageHandled?: () => void
    onOpenCitationsPanel: (payload: { citations: unknown[] }) => void
    locateMessageId?: string
  }) => {
    renderCounters.chatContent += 1
    return (
      <>
        <output data-testid="chat-content-locate-message-id">{locateMessageId ?? ''}</output>
        <button type="button" onClick={() => onLocateMessageHandled?.()}>
          handled locate
        </button>
        <button type="button" onClick={() => onOpenCitationsPanel({ citations: [{ number: 1 }] })}>
          open citations
        </button>
        <button
          type="button"
          onClick={() =>
            onBranchLiveStateChange?.({
              activeNodeId: 'assistant-live',
              nodes: [],
              topicId: 'topic-1'
            })
          }>
          push live branch state
        </button>
        <div data-testid="chat-main" />
      </>
    )
  }
}))

vi.mock('@renderer/components/chat/citations/CitationsPanel', () => ({
  default: ({ open, onClose, citations }: { open: boolean; onClose: () => void; citations: unknown[] }) => (
    <div data-testid="citations-panel" data-open={String(open)} data-count={citations.length}>
      {open && (
        <button type="button" onClick={onClose}>
          close citations
        </button>
      )}
    </div>
  )
}))

function renderChat(activeTopic: Topic) {
  return render(<Chat activeTopic={activeTopic} />)
}

describe('Chat panels', () => {
  const activeTopic: Topic = {
    id: 'topic-1',
    name: 'Topic',
    assistantId: 'assistant-1',
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    messages: []
  }

  beforeEach(() => {
    renderCounters.chatContent = 0
    renderCounters.navbar = 0
    renderCounters.eventEmit.mockReset()
    renderCounters.createAwaitingInputMessage.mockReset()
    renderCounters.createAwaitingInputMessage.mockResolvedValue(undefined)
    renderCounters.setBranchLiveState.mockReset()
  })

  it('opens and closes the citations panel from chat content', () => {
    renderChat(activeTopic)

    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('chat-navbar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'branch shortcuts' })).toBeInTheDocument()
    expect(screen.getByTestId('topic-right-pane-viewport')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'open citations' }))
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-count', '1')

    fireEvent.click(screen.getByRole('button', { name: 'close citations' }))
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'false')
  })

  it('keeps navbar and branch pane actions visible for an empty persisted topic', () => {
    const emptyTopic = { ...activeTopic, id: 'empty-topic', name: '' }

    renderChat(emptyTopic)

    expect(screen.getByTestId('chat-navbar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'branch shortcuts' })).not.toBeDisabled()
    expect(screen.getByTestId('topic-right-pane-viewport')).toBeInTheDocument()
  })

  it('does not re-render the chat shell when branch live state changes', () => {
    renderChat(activeTopic)

    const initialNavbarRenders = renderCounters.navbar
    const initialChatContentRenders = renderCounters.chatContent

    fireEvent.click(screen.getByRole('button', { name: 'push live branch state' }))

    expect(renderCounters.navbar).toBe(initialNavbarRenders)
    expect(renderCounters.chatContent).toBe(initialChatContentRenders)
    expect(renderCounters.setBranchLiveState).toHaveBeenCalledWith('topic-1', {
      activeNodeId: 'assistant-live',
      nodes: [],
      topicId: 'topic-1'
    })
  })

  it('passes branch-panel locate requests to chat content and clears them after handling', () => {
    renderChat(activeTopic)

    expect(screen.getByTestId('chat-content-locate-message-id')).toHaveTextContent('')

    fireEvent.click(screen.getByRole('button', { name: 'locate branch message' }))

    expect(screen.getByTestId('chat-content-locate-message-id')).toHaveTextContent('message-x')

    fireEvent.click(screen.getByRole('button', { name: 'handled locate' }))

    expect(screen.getByTestId('chat-content-locate-message-id')).toHaveTextContent('')
  })

  it('starts a branch draft from the right pane without re-rendering chat content', async () => {
    renderChat(activeTopic)

    const initialNavbarRenders = renderCounters.navbar
    const initialChatContentRenders = renderCounters.chatContent
    renderCounters.setBranchLiveState.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'start branch draft' }))

    await waitFor(() => {
      expect(renderCounters.createAwaitingInputMessage).toHaveBeenCalledWith({
        params: { topicId: 'topic-1' },
        body: {
          parentId: 'assistant-old',
          role: 'user',
          data: { parts: [] },
          status: 'success'
        }
      })
    })
    expect(renderCounters.navbar).toBe(initialNavbarRenders)
    expect(renderCounters.chatContent).toBe(initialChatContentRenders)
    expect(renderCounters.setBranchLiveState).not.toHaveBeenCalled()
    expect(renderCounters.eventEmit).toHaveBeenCalledWith('FOCUS_CHAT_COMPOSER', { topicId: 'topic-1' })
  })
})
