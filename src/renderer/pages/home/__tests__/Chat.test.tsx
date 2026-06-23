import type { Topic } from '@renderer/types'
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

vi.mock('@renderer/components/chat', () => ({
  ConversationShell: (props: any) => {
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
  },
  OverlayHost: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/components/chat/citations/CitationsPanel', () => ({
  default: () => <div data-testid="citations-panel" />
}))

vi.mock('@renderer/components/ContentSearch', () => ({
  ContentSearch: () => <div data-testid="content-search" />
}))

vi.mock('@renderer/components/Popups/PromptPopup', () => ({
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
  TopicRightPane.Toggle = () => <div data-testid="topic-right-toggle" />
  TopicRightPane.Host = () => <div data-testid="topic-right-pane-host" />
  TopicRightPane.MaximizedOverlay = () => <div data-testid="topic-right-pane-overlay" />

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

  it('renders the navbar and right pane toggle in the shared conversation shell', () => {
    render(<Chat activeTopic={topic} showResourceListControls />)

    expect(screen.getByTestId('chat-navbar')).toHaveAttribute('data-show-sidebar-controls', 'true')
    expect(conversationShellProps.current?.topBar).toBeTruthy()
    expect(conversationShellProps.current?.topRightTool).toBeTruthy()
    expect(screen.getByTestId('topic-right-toggle')).toBeInTheDocument()
  })

  it('keeps the navbar mounted while disabling sidebar controls', () => {
    render(<Chat activeTopic={topic} showResourceListControls={false} />)

    expect(screen.getByTestId('chat-navbar')).toHaveAttribute('data-show-sidebar-controls', 'false')
    expect(conversationShellProps.current?.topBar).toBeTruthy()
    expect(conversationShellProps.current?.topRightTool).toBeTruthy()
  })
})
