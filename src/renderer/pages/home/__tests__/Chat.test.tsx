import type { Topic } from '@renderer/types/topic'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Chat from '../Chat'

const conversationShellProps = vi.hoisted(() => ({
  current: null as any
}))

const topic: Topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  name: 'Topic',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: [],
  pinned: false,
  isNameManuallyEdited: false
}

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => ['message-style', vi.fn()]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/chat/shell/ConversationShell', () => ({
  default: (props: any) => {
    conversationShellProps.current = props
    return (
      <div data-testid="conversation-shell">
        <div data-testid="conversation-top-bar">{props.topBar}</div>
        {props.topRightTool}
        {props.center}
        {props.centerOverlay}
        {props.rightPane}
      </div>
    )
  }
}))

vi.mock('@renderer/components/chat/citations/CitationsPanel', () => ({
  default: () => <div data-testid="citations-panel" />
}))

vi.mock('@renderer/components/ContentSearch', () => ({
  ContentSearch: () => <div data-testid="content-search" />
}))

vi.mock('@renderer/components/popups/PromptPopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  useTopicMutations: () => ({
    updateTopic: vi.fn()
  })
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn()
}))

vi.mock('../ChatContent', () => ({
  default: () => <div data-testid="chat-content" />
}))

vi.mock('../components/ChatNavbar', () => ({
  default: ({ showSidebarControls }: { showSidebarControls?: boolean }) => (
    <div data-show-sidebar-controls={String(showSidebarControls)} data-testid="chat-navbar" />
  )
}))

vi.mock('../components/TopicRightPane', () => {
  const TopicRightPane = ({ children }: { children: ReactNode }) => <>{children}</>
  TopicRightPane.Shortcuts = () => <div data-testid="topic-right-shortcuts" />
  TopicRightPane.Viewport = () => <div data-testid="topic-right-pane-viewport" />

  return {
    TopicRightPane,
    useTopicBranchLiveStateSetter: () => vi.fn()
  }
})

describe('Chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    conversationShellProps.current = null
  })

  it('renders the navbar and right pane shortcuts in the shared conversation shell', () => {
    render(<Chat activeTopic={topic} showResourceListControls />)

    expect(screen.getByTestId('chat-navbar')).toHaveAttribute('data-show-sidebar-controls', 'true')
    expect(conversationShellProps.current?.topBar).toBeTruthy()
    expect(conversationShellProps.current?.topRightTool).toBeTruthy()
    expect(screen.getByTestId('topic-right-shortcuts')).toBeInTheDocument()
  })

  it('keeps the navbar mounted while disabling sidebar controls', () => {
    render(<Chat activeTopic={topic} showResourceListControls={false} />)

    expect(screen.getByTestId('chat-navbar')).toHaveAttribute('data-show-sidebar-controls', 'false')
    expect(conversationShellProps.current?.topBar).toBeTruthy()
    expect(conversationShellProps.current?.topRightTool).toBeTruthy()
  })

  it('forwards an alternate center surface without replacing the chat shell', () => {
    const centerSurface = { content: <div data-testid="history-center" /> }

    render(<Chat activeTopic={topic} centerSurface={centerSurface} />)

    expect(screen.getByTestId('conversation-shell')).toBeInTheDocument()
    expect(conversationShellProps.current?.centerSurface).toBe(centerSurface)
  })

  it('renders the fallback center in the same shell before a topic is available', () => {
    render(<Chat centerFallback={<div data-testid="loading-center" />} />)

    expect(screen.getByTestId('conversation-shell')).toBeInTheDocument()
    expect(screen.getByTestId('loading-center')).toBeInTheDocument()
    expect(conversationShellProps.current?.topBar).toBeUndefined()
    expect(conversationShellProps.current?.topRightTool).toBeUndefined()
  })
})
