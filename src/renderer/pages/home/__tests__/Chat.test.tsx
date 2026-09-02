import type * as ChatLayoutModeContextModule from '@renderer/components/chat/layout/ChatLayoutModeContext'
import { popup } from '@renderer/services/popup'
import type { Topic } from '@renderer/types/topic'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
const commandHandlers = vi.hoisted(() => new Map<string, () => void | Promise<void>>())
const eventEmitMock = vi.hoisted(() => vi.fn())
const clearTopicMessagesMock = vi.hoisted(() => vi.fn(async () => undefined))
const activeTabMock = vi.hoisted(() => ({ current: true }))

const topic: Topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  name: 'Topic',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
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

vi.mock('@renderer/components/chat/shell/ConversationCenterState', () => ({
  default: ({ state }: { state: string }) => <div data-testid="conversation-center-state">{state}</div>
}))

vi.mock('@renderer/components/FindBar', () => ({
  FindBar: () => <div data-testid="content-search" />
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
  useProviders: (_query?: unknown, options?: { enabled?: boolean }) => ({
    providers: options?.enabled === false ? [] : [{ id: 'provider', name: 'Provider' }]
  })
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (command: string, handler: () => void | Promise<void>, options?: { enabled?: boolean }) => {
    if (options?.enabled === false) commandHandlers.delete(command)
    else commandHandlers.set(command, handler)
  }
}))

vi.mock('@renderer/hooks/tab', () => ({
  useIsActiveTab: () => activeTabMock.current
}))

vi.mock('@renderer/hooks/chat/useClearTopicMessages', () => ({
  useClearTopicMessages: () => clearTopicMessagesMock
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    FOCUS_CHAT_COMPOSER: 'focus-chat-composer'
  },
  EventEmitter: {
    emit: eventEmitMock
  }
}))

vi.mock('@renderer/components/composer/variants/chat/ChatConversationControls', () => ({
  ChatConversationControls: ({ assistantName, model, providers }: any) => {
    const provider = providers.find((currentProvider: any) => currentProvider.id === model?.providerId)
    return (
      <div data-testid="chat-conversation-controls">
        {assistantName}
        {model && provider ? `${model.name} | ${provider.name}` : null}
      </div>
    )
  }
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn()
}))

vi.mock('../ChatContent', async () => {
  const { useChatLayoutMode } = await vi.importActual<typeof ChatLayoutModeContextModule>(
    '@renderer/components/chat/layout/ChatLayoutModeContext'
  )

  function MockChatContent(props: any) {
    chatContentProps.current = props
    const { railGutterPx, setRailGutterPx } = useChatLayoutMode()

    return (
      <div data-testid="chat-content">
        <output aria-label="rail gutter">{railGutterPx}</output>
        <button type="button" onClick={() => setRailGutterPx(24)}>
          reserve rail gutter
        </button>
      </div>
    )
  }

  return {
    default: MockChatContent
  }
})

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
    commandHandlers.clear()
    activeTabMock.current = true
  })

  it('clears the active topic once the confirmation is accepted', async () => {
    render(<Chat activeTopic={topic} />)

    await act(async () => {
      await commandHandlers.get('topic.clear_messages')?.()
    })

    expect(popup.confirm).toHaveBeenCalled()
    expect(clearTopicMessagesMock).toHaveBeenCalledWith(topic.id)
  })

  it('leaves the topic untouched when the confirmation is dismissed', async () => {
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)

    render(<Chat activeTopic={topic} />)

    await act(async () => {
      await commandHandlers.get('topic.clear_messages')?.()
    })

    expect(clearTopicMessagesMock).not.toHaveBeenCalled()
  })

  it('does not register the clear-messages command for a background tab', () => {
    activeTabMock.current = false

    render(<Chat activeTopic={topic} />)

    expect(commandHandlers.has('topic.clear_messages')).toBe(false)
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

  it('loads provider metadata for the single-model trigger', () => {
    render(<Chat activeTopic={topic} />)

    expect(screen.getByTestId('chat-conversation-controls')).toHaveTextContent('Model | Provider')
  })

  it('preserves the rail gutter while switching topics', async () => {
    const user = userEvent.setup()
    const view = render(<Chat activeTopic={topic} />)

    await user.click(screen.getByRole('button', { name: 'reserve rail gutter' }))
    expect(screen.getByRole('status', { name: 'rail gutter' })).toHaveTextContent('24')

    view.rerender(<Chat activeTopic={{ ...topic, id: 'topic-2' }} />)

    expect(screen.getByRole('status', { name: 'rail gutter' })).toHaveTextContent('24')
  })

  it('renders the navbar while the active topic is still resolving', () => {
    render(<Chat showResourceListControls topicPending />)

    expect(screen.getByTestId('chat-navbar')).toBeInTheDocument()
    expect(conversationShellProps.current?.topBar).toBeTruthy()
    expect(conversationShellProps.current?.topRightTool).toBeFalsy()
    expect(screen.getByTestId('conversation-center-state')).toHaveTextContent('loading')
  })

  it('settles on the empty center once the entry resolved no topic', () => {
    render(<Chat showResourceListControls />)

    expect(screen.getByTestId('conversation-center-state')).toHaveTextContent('empty')
  })
})
