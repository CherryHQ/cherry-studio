import type { Topic } from '@renderer/types/topic'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Chat from '../Chat'

const conversationShellProps = vi.hoisted(() => ({
  current: null as any
}))
const chatContentProps = vi.hoisted(() => ({
  current: null as any
}))
const assistantContextMock = vi.hoisted(() => ({
  isLoading: false,
  isModelPending: false
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

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: {
      id: 'assistant-1',
      name: 'Assistant',
      emoji: '😀',
      modelId: 'provider::model',
      settings: {}
    },
    isLoading: assistantContextMock.isLoading,
    model: {
      id: 'provider::model',
      providerId: 'provider',
      apiModelId: 'model',
      name: 'Model'
    },
    isModelPending: assistantContextMock.isModelPending,
    isModelMissing: false,
    setModel: vi.fn(),
    updateAssistantSettings: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] })
}))

vi.mock('@renderer/components/composer/variants/chat/ChatConversationControls', () => ({
  ChatConversationControls: ({ assistantName }: { assistantName: string }) => (
    <div data-testid="chat-conversation-controls">{assistantName}</div>
  )
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn()
}))

vi.mock('../ChatContent', () => ({
  default: (props: any) => {
    chatContentProps.current = props
    return <div data-testid="chat-content" />
  }
}))

vi.mock('../components/ChatNavbar', () => ({
  default: ({
    conversationControls,
    showSidebarControls
  }: {
    conversationControls?: ReactNode
    showSidebarControls?: boolean
  }) => (
    <div data-show-sidebar-controls={String(showSidebarControls)} data-testid="chat-navbar">
      {conversationControls}
    </div>
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
    chatContentProps.current = null
    assistantContextMock.isLoading = false
    assistantContextMock.isModelPending = false
  })

  it('renders the navbar and right pane shortcuts in the shared conversation shell', () => {
    render(<Chat activeTopic={topic} showResourceListControls />)

    expect(screen.getByTestId('chat-navbar')).toHaveAttribute('data-show-sidebar-controls', 'true')
    expect(conversationShellProps.current?.topBar).toBeTruthy()
    expect(conversationShellProps.current?.topRightTool).toBeTruthy()
    expect(screen.getByTestId('topic-right-shortcuts')).toBeInTheDocument()
    expect(screen.getByTestId('chat-conversation-controls')).toHaveTextContent('Assistant')
    expect(chatContentProps.current?.assistantContext?.assistant?.id).toBe('assistant-1')
  })

  it('keeps the navbar mounted while disabling sidebar controls', () => {
    render(<Chat activeTopic={topic} showResourceListControls={false} />)

    expect(screen.getByTestId('chat-navbar')).toHaveAttribute('data-show-sidebar-controls', 'false')
    expect(conversationShellProps.current?.topBar).toBeTruthy()
    expect(conversationShellProps.current?.topRightTool).toBeTruthy()
  })

  it('keeps the composer context available while the assistant and model are resolving', () => {
    assistantContextMock.isLoading = true
    assistantContextMock.isModelPending = true

    render(<Chat activeTopic={topic} />)

    expect(chatContentProps.current?.assistantContext?.isLoading).toBe(true)
    expect(chatContentProps.current?.assistantContext?.isModelPending).toBe(true)
  })

  it('renders the navbar while the active topic is still resolving', () => {
    render(<Chat showResourceListControls />)

    expect(screen.getByTestId('chat-navbar')).toBeInTheDocument()
    expect(conversationShellProps.current?.topBar).toBeTruthy()
    expect(conversationShellProps.current?.topRightTool).toBeFalsy()
  })
})
