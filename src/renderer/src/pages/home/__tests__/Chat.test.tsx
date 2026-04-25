import type { Assistant, Topic } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  eventEmitter: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn())
  },
  messagesMounts: 0,
  messagesUnmounts: 0,
  useAssistant: vi.fn(),
  useChatContext: vi.fn(),
  useNavbarPosition: vi.fn(),
  useSettings: vi.fn(),
  useShowTopics: vi.fn(),
  useShortcut: vi.fn(),
  useTimer: vi.fn(),
  useTranslation: vi.fn(),
  updateAssistant: vi.fn(),
  updateTopic: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/ContentSearch', () => ({
  ContentSearch: () => <div data-testid="content-search" />
}))

vi.mock('@renderer/components/Layout', () => ({
  HStack: ({ children }: { children: React.ReactNode }) => <div data-testid="hstack">{children}</div>
}))

vi.mock('@renderer/components/Popups/MultiSelectionPopup', () => ({
  default: () => <div data-testid="multi-select-popup" />
}))

vi.mock('@renderer/components/Popups/PromptPopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('@renderer/components/Popups/SelectModelPopup', () => ({
  SelectChatModelPopup: {
    show: vi.fn()
  }
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/config/models', () => ({
  isEmbeddingModel: vi.fn().mockReturnValue(false),
  isRerankModel: vi.fn().mockReturnValue(false),
  isWebSearchModel: vi.fn().mockReturnValue(false)
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: (...args: unknown[]) => mocks.useAssistant(...args)
}))

vi.mock('@renderer/hooks/useChatContext', () => ({
  useChatContext: (...args: unknown[]) => mocks.useChatContext(...args)
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useNavbarPosition: () => mocks.useNavbarPosition(),
  useSettings: () => mocks.useSettings()
}))

vi.mock('@renderer/hooks/useShortcuts', () => ({
  useShortcut: (...args: unknown[]) => mocks.useShortcut(...args)
}))

vi.mock('@renderer/hooks/useStore', () => ({
  useShowTopics: () => mocks.useShowTopics()
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => mocks.useTimer()
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    SHOW_TOPIC_SIDEBAR: 'show-topic-sidebar'
  },
  EventEmitter: mocks.eventEmitter
}))

vi.mock('@renderer/utils', () => ({
  classNames: (items: Array<Record<string, boolean> | string | undefined>) =>
    items
      .flatMap((item) => {
        if (!item) return []
        if (typeof item === 'string') return [item]
        return Object.entries(item)
          .filter(([, value]) => value)
          .map(([key]) => key)
      })
      .join(' ')
}))

vi.mock('antd', () => ({
  Flex: ({ ref, children, ...props }) => (
    <div ref={ref} {...props}>
      {children}
    </div>
  )
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode }) => <div {...props}>{children}</div>
  }
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: () => undefined
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => mocks.useTranslation()
}))

vi.mock('../components/ChatNavBar', () => ({
  default: () => <div data-testid="chat-navbar" />
}))

vi.mock('../Inputbar/Inputbar', () => ({
  default: () => <div data-testid="inputbar" />
}))

vi.mock('../Messages/ChatNavigation', () => ({
  default: () => <div data-testid="chat-navigation" />
}))

const MessagesMock = ({ topic }: { topic: Topic }) => {
  const [count, setCount] = useState(0)

  useEffect(() => {
    mocks.messagesMounts += 1
    return () => {
      mocks.messagesUnmounts += 1
    }
  }, [])

  return (
    <div data-testid="messages" data-topic-id={topic.id} data-count={count}>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        bump
      </button>
    </div>
  )
}

vi.mock('../Messages/Messages', () => ({
  default: MessagesMock
}))

vi.mock('../Tabs', () => ({
  default: () => <div data-testid="tabs" />
}))

const { default: Chat } = await import('../Chat')

const createAssistant = (): Assistant =>
  ({
    id: 'assistant-1',
    model: { id: 'model-1', name: 'Model 1', provider: 'provider-1' },
    prompt: 'Prompt text',
    enableWebSearch: false,
    topics: [],
    name: 'Assistant'
  }) as Assistant

const createTopic = (id: string): Topic =>
  ({
    id,
    name: id,
    prompt: ''
  }) as Topic

describe('Chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.messagesMounts = 0
    mocks.messagesUnmounts = 0
    mocks.useAssistant.mockReturnValue({
      assistant: createAssistant(),
      updateAssistant: mocks.updateAssistant,
      updateTopic: mocks.updateTopic
    })
    mocks.useChatContext.mockReturnValue({ isMultiSelectMode: false, handleSelectMessage: vi.fn() })
    mocks.useNavbarPosition.mockReturnValue({ isTopNavbar: false })
    mocks.useSettings.mockReturnValue({
      topicPosition: 'left',
      messageStyle: '',
      messageNavigation: 'buttons'
    })
    mocks.useShowTopics.mockReturnValue({ showTopics: false })
    mocks.useShortcut.mockReturnValue(undefined)
    mocks.useTimer.mockReturnValue({ setTimeoutTimer: vi.fn() })
    mocks.useTranslation.mockReturnValue({ t: (key: string) => key })
  })

  it('preserves the messages subtree when switching topics', () => {
    const assistant = createAssistant()
    const topicOne = createTopic('topic-1')
    const topicTwo = createTopic('topic-2')
    const setActiveTopic = vi.fn()
    const setActiveAssistant = vi.fn()

    const { rerender } = render(
      <Chat
        assistant={assistant}
        activeTopic={topicOne}
        setActiveTopic={setActiveTopic}
        setActiveAssistant={setActiveAssistant}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'bump' }))
    expect(screen.getByTestId('messages')).toHaveAttribute('data-count', '1')
    expect(screen.getByTestId('messages')).toHaveAttribute('data-topic-id', 'topic-1')

    rerender(
      <Chat
        assistant={assistant}
        activeTopic={topicTwo}
        setActiveTopic={setActiveTopic}
        setActiveAssistant={setActiveAssistant}
      />
    )

    expect(screen.getByTestId('messages')).toHaveAttribute('data-topic-id', 'topic-2')
    expect(screen.getByTestId('messages')).toHaveAttribute('data-count', '1')
    expect(mocks.messagesMounts).toBe(1)
    expect(mocks.messagesUnmounts).toBe(0)
  })
})
