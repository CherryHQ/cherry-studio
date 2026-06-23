import type { Topic } from '@renderer/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Chat from '../Chat'

const renderCounters = vi.hoisted(() => ({
  chatContent: 0,
  navbar: 0,
  eventEmit: vi.fn(),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
  putActiveNode: vi.fn().mockResolvedValue(undefined),
  readBranchAnchor: vi.fn(),
  setBranchLiveState: vi.fn()
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'chat.message.style') return ['message-style']

    return [undefined, vi.fn()]
  }
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => renderCounters.invalidateCache
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    put: renderCounters.putActiveNode
  }
}))

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

vi.mock('@renderer/components/chat', () => ({
  OverlayHost: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ConversationShell: ({
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

vi.mock('@renderer/components/Popups/PromptPopup', () => ({
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
  const TopicRightPane = Object.assign(({ children }: PropsWithChildren) => <div>{children}</div>, {
    Toggle: ({ disabled }: { disabled?: boolean }) => (
      <button type="button" disabled={disabled}>
        branch toggle
      </button>
    ),
    Host: ({
      onLocateMessage,
      onCancelBranchDraft,
      onStartBranchDraft,
      topicId
    }: {
      onLocateMessage?: (messageId: string) => void
      onCancelBranchDraft?: (nextActiveNodeId?: string | null) => void
      onStartBranchDraft?: (messageId: string) => void | Promise<void>
      topicId: string
    }) => (
      <div data-testid="topic-right-pane-host" data-topic-id={topicId}>
        <button type="button" onClick={() => onLocateMessage?.('message-x')}>
          locate branch message
        </button>
        <button type="button" onClick={() => void onStartBranchDraft?.('assistant-old')}>
          start branch draft
        </button>
        <button type="button" onClick={() => onCancelBranchDraft?.('assistant-next')}>
          cancel branch draft to next
        </button>
      </div>
    ),
    MaximizedOverlay: ({
      onStartBranchDraft,
      topicId
    }: {
      onStartBranchDraft?: (messageId: string) => void | Promise<void>
      topicId: string
    }) => (
      <div data-testid="topic-right-pane-overlay" data-topic-id={topicId}>
        <button type="button" onClick={() => void onStartBranchDraft?.('assistant-overlay')}>
          start overlay branch draft
        </button>
      </div>
    )
  })

  return {
    TopicRightPane,
    useTopicBranchLiveStateSetter: () => renderCounters.setBranchLiveState
  }
})

vi.mock('../ChatContent', () => ({
  default: ({
    onBranchLiveStateChange,
    getBranchDraftAnchorId,
    onLocateMessageHandled,
    onOpenCitationsPanel,
    locateMessageId
  }: {
    onBranchLiveStateChange?: (state: unknown) => void
    getBranchDraftAnchorId?: () => string | null
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
        <button type="button" onClick={() => renderCounters.readBranchAnchor(getBranchDraftAnchorId?.() ?? null)}>
          read branch anchor
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
    renderCounters.invalidateCache.mockReset()
    renderCounters.invalidateCache.mockResolvedValue(undefined)
    renderCounters.putActiveNode.mockReset()
    renderCounters.putActiveNode.mockResolvedValue(undefined)
    renderCounters.readBranchAnchor.mockReset()
    renderCounters.setBranchLiveState.mockReset()
  })

  it('opens and closes the citations panel from chat content', () => {
    render(<Chat activeTopic={activeTopic} />)

    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('chat-navbar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'branch toggle' })).toBeInTheDocument()
    expect(screen.getByTestId('topic-right-pane-host')).toHaveAttribute('data-topic-id', 'topic-1')
    expect(screen.getByTestId('topic-right-pane-overlay')).toHaveAttribute('data-topic-id', 'topic-1')

    fireEvent.click(screen.getByRole('button', { name: 'open citations' }))
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-count', '1')

    fireEvent.click(screen.getByRole('button', { name: 'close citations' }))
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'false')
  })

  it('keeps navbar and branch pane actions visible for an empty persisted topic', () => {
    const emptyTopic = { ...activeTopic, id: 'empty-topic', name: '' }

    render(<Chat activeTopic={emptyTopic} />)

    expect(screen.getByTestId('chat-navbar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'branch toggle' })).not.toBeDisabled()
    expect(screen.getByTestId('topic-right-pane-host')).toHaveAttribute('data-topic-id', 'empty-topic')
    expect(screen.getByTestId('topic-right-pane-overlay')).toHaveAttribute('data-topic-id', 'empty-topic')
  })

  it('does not re-render the chat shell when branch live state changes', () => {
    render(<Chat activeTopic={activeTopic} />)

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
    render(<Chat activeTopic={activeTopic} />)

    expect(screen.getByTestId('chat-content-locate-message-id')).toHaveTextContent('')

    fireEvent.click(screen.getByRole('button', { name: 'locate branch message' }))

    expect(screen.getByTestId('chat-content-locate-message-id')).toHaveTextContent('message-x')

    fireEvent.click(screen.getByRole('button', { name: 'handled locate' }))

    expect(screen.getByTestId('chat-content-locate-message-id')).toHaveTextContent('')
  })

  it('starts a branch draft from the right pane without re-rendering chat content', async () => {
    render(<Chat activeTopic={activeTopic} />)

    const initialNavbarRenders = renderCounters.navbar
    const initialChatContentRenders = renderCounters.chatContent
    renderCounters.setBranchLiveState.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'start branch draft' }))

    await waitFor(() => {
      expect(renderCounters.putActiveNode).toHaveBeenCalledWith('/topics/topic-1/active-node', {
        body: { nodeId: 'assistant-old' }
      })
    })
    expect(renderCounters.navbar).toBe(initialNavbarRenders)
    expect(renderCounters.chatContent).toBe(initialChatContentRenders)
    expect(renderCounters.setBranchLiveState).toHaveBeenCalledWith('topic-1', {
      activeNodeId: 'branch-draft:assistant-old',
      nodes: [
        expect.objectContaining({
          id: 'branch-draft:assistant-old',
          isInputDraft: true,
          parentId: 'assistant-old',
          preview: 'chat.message.flow.status.awaiting_input',
          role: 'user',
          status: 'paused'
        })
      ],
      topicId: 'topic-1'
    })
    expect(renderCounters.invalidateCache).toHaveBeenCalledWith('/topics/topic-1/messages')
    expect(renderCounters.invalidateCache).not.toHaveBeenCalledWith('/topics/topic-1/tree')
    expect(renderCounters.eventEmit).toHaveBeenCalledWith('FOCUS_CHAT_COMPOSER', { topicId: 'topic-1' })
  })

  it('cancels a branch draft into active-only live state and updates the send anchor override', async () => {
    render(<Chat activeTopic={activeTopic} />)

    fireEvent.click(screen.getByRole('button', { name: 'start branch draft' }))

    await waitFor(() => {
      expect(renderCounters.putActiveNode).toHaveBeenCalledWith('/topics/topic-1/active-node', {
        body: { nodeId: 'assistant-old' }
      })
    })

    renderCounters.setBranchLiveState.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'cancel branch draft to next' }))
    fireEvent.click(screen.getByRole('button', { name: 'read branch anchor' }))

    expect(renderCounters.setBranchLiveState).toHaveBeenCalledWith('topic-1', {
      activeNodeId: 'assistant-next',
      nodes: [],
      topicId: 'topic-1'
    })
    expect(renderCounters.readBranchAnchor).toHaveBeenCalledWith('assistant-next')
  })
})
