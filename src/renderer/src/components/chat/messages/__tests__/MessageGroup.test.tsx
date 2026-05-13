import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { createEvent, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  editMessage: vi.fn(),
  editMessageBlocks: vi.fn(),
  resendUserMessageWithEdit: vi.fn(),
  scrollIntoView: vi.fn(),
  setTimeoutTimer: vi.fn(),
  useChatContext: vi.fn().mockReturnValue({ isMultiSelectMode: false }),
  settings: vi.fn().mockReturnValue({
    multiModelMessageStyle: 'horizontal',
    gridColumns: 2,
    gridPopoverTrigger: 'click',
    messageFont: 'system',
    fontSize: 14,
    messageStyle: 'plain',
    showMessageOutline: false
  }),
  EventEmitter: {
    on: vi.fn(() => vi.fn()),
    off: vi.fn(),
    emit: vi.fn()
  },
  MessageEditingProvider: vi.fn(({ children }: { children: ReactNode }) => <>{children}</>),
  useMessageEditing: vi.fn().mockReturnValue({
    editingMessageId: null,
    startEditing: vi.fn(),
    stopEditing: vi.fn()
  }),
  MessageGroupMenuBar: vi.fn(() => <div className="group-menu-bar">menu</div>),
  HorizontalScrollContainer: vi.fn(({ children }: { children: ReactNode }) => <div>{children}</div>),
  MessageContent: vi.fn(() => <div style={{ minHeight: 600 }}>Long message content</div>),
  MessageEditor: vi.fn(() => <div>editor</div>),
  MessageErrorBoundary: vi.fn(({ children }: { children: ReactNode }) => <>{children}</>),
  MessageHeader: vi.fn(() => <div className="message-header">header</div>),
  MessageMenuBar: vi.fn(() => <div className="message-menubar">menubar</div>),
  MessageOutline: vi.fn(() => null)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: vi.fn(() => undefined)
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    const settings = mocks.settings()
    const values: Record<string, unknown> = {
      'chat.message.multi_model.style': settings.multiModelMessageStyle,
      'chat.message.multi_model.grid_columns': settings.gridColumns,
      'chat.message.multi_model.grid_popover_trigger': settings.gridPopoverTrigger,
      'chat.message.font': settings.messageFont,
      'chat.message.font_size': settings.fontSize,
      'chat.message.style': settings.messageStyle,
      'chat.message.show_outline': settings.showMessageOutline
    }
    return [values[key]]
  }
}))

vi.mock('@renderer/components/HorizontalScrollContainer', () => ({
  default: mocks.HorizontalScrollContainer
}))

vi.mock('@renderer/components/Popups/UserPopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('@renderer/context/MessageEditingContext', () => ({
  MessageEditingProvider: mocks.MessageEditingProvider,
  useMessageEditing: () => mocks.useMessageEditing()
}))

vi.mock('@renderer/utils', () => {
  const flattenClassNames = (value: unknown): string[] => {
    if (!value) return []
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap(flattenClassNames)
    if (typeof value === 'object') {
      return Object.entries(value as Record<string, boolean>)
        .filter(([, enabled]) => enabled)
        .map(([className]) => className)
    }
    return []
  }

  return {
    classNames: (value: unknown) => flattenClassNames(value).join(' '),
    cn: (...values: unknown[]) => flattenClassNames(values).join(' ')
  }
})

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: null,
    setModel: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useChatContext', () => ({
  useChatContext: () => mocks.useChatContext()
}))

vi.mock('@renderer/hooks/useMessageOperations', () => ({
  useMessageOperations: () => ({
    editMessage: mocks.editMessage,
    editMessageBlocks: mocks.editMessageBlocks,
    resendUserMessageWithEdit: mocks.resendUserMessageWithEdit
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModel: () => null
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: mocks.setTimeoutTimer
  })
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    LOCATE_MESSAGE: 'locate-message',
    EDIT_MESSAGE: 'edit-message',
    NEW_CONTEXT: 'new-context'
  },
  EventEmitter: mocks.EventEmitter
}))

vi.mock('@renderer/services/MessagesService', () => ({
  getMessageModelId: () => 'model-id'
}))

vi.mock('@renderer/services/TokenService', () => ({
  estimateMessageUsage: vi.fn().mockResolvedValue(0)
}))

vi.mock('@renderer/utils/dom', () => ({
  scrollIntoView: mocks.scrollIntoView
}))

vi.mock('@renderer/utils/messageUtils/is', () => ({
  isMessageAwaitingApproval: () => false,
  isMessageProcessing: () => false
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../frame/MessageContent', () => ({
  default: mocks.MessageContent
}))

vi.mock('../frame/MessageEditor', () => ({
  default: mocks.MessageEditor
}))

vi.mock('../frame/MessageErrorBoundary', () => ({
  default: mocks.MessageErrorBoundary
}))

vi.mock('../list/MessageGroupMenuBar', () => ({
  default: mocks.MessageGroupMenuBar
}))

vi.mock('../MessageListProvider', () => ({
  useMessageList: () => ({
    state: {},
    actions: {
      setActiveBranch: vi.fn(),
      deleteMessageGroup: vi.fn(),
      regenerateMessage: vi.fn()
    },
    meta: {}
  })
}))

vi.mock('../frame/MessageHeader', () => ({
  default: mocks.MessageHeader
}))

vi.mock('../frame/MessageMenuBar', () => ({
  default: mocks.MessageMenuBar
}))

vi.mock('../frame/MessageOutline', () => ({
  default: mocks.MessageOutline
}))

const { default: MessageGroup } = await import('../list/MessageGroup')

const createMessage = (id: string, index: number, multiModelMessageStyle: Message['multiModelMessageStyle']) =>
  ({
    id,
    askId: 'ask-1',
    role: 'assistant',
    blocks: [],
    multiModelMessageStyle,
    index
  }) as unknown as Message & { index: number }

const setElementSize = (
  element: Element,
  dimensions: Partial<{
    clientHeight: number
    clientWidth: number
    scrollHeight: number
    scrollLeft: number
    scrollWidth: number
  }>
) => {
  for (const [key, value] of Object.entries(dimensions)) {
    Object.defineProperty(element, key, {
      configurable: true,
      value,
      writable: true
    })
  }
}

describe('MessageGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps vertical scrolling inside the message content area for horizontal layout', () => {
    const messages = [createMessage('msg-1', 0, 'horizontal'), createMessage('msg-2', 1, 'horizontal')]
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup messages={messages} topic={topic} />)

    const outerWrapper = document.getElementById('message-msg-1')
    expect(outerWrapper).not.toBeNull()
    expect(getComputedStyle(outerWrapper!).overflowY).toBe('visible')

    const contentContainer = container.querySelector('#message-msg-1 .message-content-container')
    expect(contentContainer).not.toBeNull()
    expect(getComputedStyle(contentContainer as HTMLElement).overflowY).toBe('auto')

    const horizontalGroup = outerWrapper!.parentElement as HTMLElement
    expect(getComputedStyle(horizontalGroup).overflowX).toBe('auto')
    expect(getComputedStyle(horizontalGroup).overflowY).toBe('hidden')
  })

  it('prevents vertical wheel on non-content areas from bubbling to the outer chat scroll in horizontal layout', () => {
    const parentWheel = vi.fn()
    const messages = [createMessage('msg-1', 0, 'horizontal'), createMessage('msg-2', 1, 'horizontal')]
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(
      <div onWheel={parentWheel}>
        <MessageGroup messages={messages} topic={topic} />
      </div>
    )

    const outerWrapper = container.querySelector('#message-msg-1') as HTMLElement
    const horizontalGroup = outerWrapper.parentElement as HTMLElement
    const contentContainers = container.querySelectorAll('.message-content-container')

    expect(horizontalGroup).not.toBeNull()
    expect(contentContainers).toHaveLength(2)

    contentContainers.forEach((contentContainer) => {
      setElementSize(contentContainer, {
        clientHeight: 300,
        scrollHeight: 600
      })
    })

    const wheelEvent = createEvent.wheel(horizontalGroup, { deltaY: 120 })
    fireEvent(horizontalGroup, wheelEvent)

    expect(parentWheel).not.toHaveBeenCalled()
  })

  it('supports horizontal wheel scrolling on non-content areas in horizontal layout', () => {
    const messages = [createMessage('msg-1', 0, 'horizontal'), createMessage('msg-2', 1, 'horizontal')]
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup messages={messages} topic={topic} />)

    const outerWrapper = container.querySelector('#message-msg-1') as HTMLElement
    const horizontalGroup = outerWrapper.parentElement as HTMLElement
    expect(horizontalGroup).not.toBeNull()

    setElementSize(horizontalGroup, {
      clientWidth: 500,
      scrollLeft: 0,
      scrollWidth: 1000
    })

    const wheelEvent = createEvent.wheel(horizontalGroup, { deltaX: 160 })
    fireEvent(horizontalGroup, wheelEvent)

    expect(horizontalGroup.scrollLeft).toBe(160)
  })

  it('preserves visible content overflow for non-horizontal layouts', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'vertical',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })

    const messages = [createMessage('msg-1', 0, 'vertical'), createMessage('msg-2', 1, 'vertical')]
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup messages={messages} topic={topic} />)

    const contentContainer = container.querySelector('#message-msg-1 .message-content-container')
    expect(contentContainer).not.toBeNull()
    expect(getComputedStyle(contentContainer as HTMLElement).overflowY).toBe('visible')
  })
})
