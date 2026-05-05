import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  editMessage: vi.fn(),
  scrollIntoView: vi.fn(),
  setTimeoutTimer: vi.fn(),
  useChatContext: vi.fn().mockReturnValue({ isMultiSelectMode: false }),
  useSettings: vi.fn().mockReturnValue({
    multiModelMessageStyle: 'horizontal',
    gridColumns: 2,
    gridPopoverTrigger: 'click'
  }),
  EventEmitter: {
    on: vi.fn(),
    off: vi.fn()
  },
  MessageEditingProvider: vi.fn(({ children }: { children: ReactNode }) => <>{children}</>),
  MessageGroupMenuBar: vi.fn(() => <div className="group-menu-bar">menu</div>),
  MessageItem: vi.fn(({ message }: { message: Message }) => (
    <div className="message">
      <div className="message-content-container" data-testid={`content-${message.id}`}>
        Long message content
      </div>
      <div className="MessageFooter">footer</div>
    </div>
  ))
}))

vi.mock('@renderer/context/MessageEditingContext', () => ({
  MessageEditingProvider: mocks.MessageEditingProvider
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

vi.mock('uuid', () => ({
  default: () => 'test-uuid',
  v4: () => 'test-uuid'
}))

vi.mock('@renderer/hooks/useChatContext', () => ({
  useChatContext: () => mocks.useChatContext()
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: null
  })
}))

vi.mock('@renderer/hooks/useMessageOperations', () => ({
  useMessageOperations: () => ({
    editMessage: mocks.editMessage
  })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => mocks.useSettings()
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: mocks.setTimeoutTimer
  })
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    LOCATE_MESSAGE: 'locate-message'
  },
  EventEmitter: mocks.EventEmitter
}))

vi.mock('@renderer/utils/dom', () => ({
  scrollIntoView: mocks.scrollIntoView
}))

vi.mock('../Message', () => ({
  default: mocks.MessageItem
}))

vi.mock('../MessageGroupMenuBar', () => ({
  default: mocks.MessageGroupMenuBar
}))

const { default: MessageGroup } = await import('../MessageGroup')

const createMessage = (id: string, _index: number) =>
  ({
    id,
    askId: 'ask-1',
    role: 'assistant',
    blocks: [],
    multiModelMessageStyle: 'horizontal'
  }) as unknown as Message

describe('MessageGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses only the inner content container for vertical scrolling in horizontal layout', () => {
    const messages = [createMessage('msg-1', 0), createMessage('msg-2', 1)]
    const topic = { id: 'topic-1' } as Topic

    render(<MessageGroup messages={messages} topic={topic} />)

    const outerWrapper = document.getElementById('message-msg-1')
    expect(outerWrapper).not.toBeNull()
    expect(getComputedStyle(outerWrapper!).overflowY).toBe('visible')

    const contentContainer = screen.getByTestId('content-msg-1')
    expect(getComputedStyle(contentContainer).overflowY).toBe('auto')

    const horizontalGroup = outerWrapper!.parentElement as HTMLElement
    expect(getComputedStyle(horizontalGroup).overflowX).toBe('auto')
  })
})
