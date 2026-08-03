import type { Topic } from '@renderer/types/topic'
import { act, render, screen } from '@testing-library/react'
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
const providerHookArgs = vi.hoisted(() => [] as unknown[][])

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
  useProviders: (...args: unknown[]) => {
    providerHookArgs.push(args)
    return { providers: [] }
  }
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
  const TopicRightPane = {
    Scope: ({ children }: { children: ReactNode }) => <>{children}</>,
    Shortcuts: () => <div data-testid="topic-right-shortcuts" />,
    Viewport: () => <div data-testid="topic-right-pane-viewport" />
  }

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
    providerHookArgs.length = 0
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

  it('loads provider metadata only for multi-model control details', () => {
    render(<Chat activeTopic={topic} />)

    expect(providerHookArgs.at(-1)).toEqual([undefined, { enabled: false }])

    act(() => {
      chatContentProps.current?.onConversationControlsChange?.({
        scopeKey: topic.id,
        mentionedModels: [],
        mentionedModelSelectorValue: [{ id: 'provider::model-a' }, { id: 'provider::model-b' }],
        lockedMentionedModels: []
      })
    })

    expect(providerHookArgs.at(-1)).toEqual([undefined, { enabled: true }])
  })

  it('renders the navbar while the active topic is still resolving', () => {
    render(<Chat showResourceListControls />)

    expect(screen.getByTestId('chat-navbar')).toBeInTheDocument()
    expect(conversationShellProps.current?.topBar).toBeTruthy()
    expect(conversationShellProps.current?.topRightTool).toBeFalsy()
  })

  it('renders an alternate center surface without replacing the chat shell', () => {
    const centerSurface = { content: <div data-testid="history-center" /> }

    render(<Chat activeTopic={topic} centerSurface={centerSurface} />)

    expect(screen.getByTestId('conversation-shell')).toBeInTheDocument()
    expect(screen.getByTestId('history-center')).toBeInTheDocument()
    expect(conversationShellProps.current?.topBar).toBeUndefined()
  })

  it('renders the fallback center in the same shell before a topic is available', () => {
    render(<Chat centerFallback={<div data-testid="loading-center" />} />)

    expect(screen.getByTestId('conversation-shell')).toBeInTheDocument()
    expect(screen.getByTestId('loading-center')).toBeInTheDocument()
    expect(conversationShellProps.current?.topBar).toBeUndefined()
    expect(conversationShellProps.current?.topRightTool).toBeUndefined()
  })
})
