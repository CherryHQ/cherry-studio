import type { Topic } from '@renderer/types'
import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import type { Model } from '@shared/data/types/model'
import { act, createEvent, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageEnterMotionProvider } from '../../motion/messageEnterMotion'
import type { MessageListItem } from '../types'

const mocks = vi.hoisted(() => ({
  editMessage: vi.fn(),
  editMessageBlocks: vi.fn(),
  resendUserMessageWithEdit: vi.fn(),
  scrollIntoView: vi.fn(),
  setTimeoutTimer: vi.fn(),
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
  MessageGroupMenuBar: vi.fn(() => <div className="group-menu-bar">menu</div>),
  HorizontalScrollContainer: vi.fn(({ children }: { children: ReactNode }) => <div>{children}</div>),
  MessageContent: vi.fn(() => <div style={{ minHeight: 600 }}>Long message content</div>),
  MessageErrorBoundary: vi.fn(({ children }: { children: ReactNode }) => <>{children}</>),
  MessageHeader: vi.fn(({ contentSlot, footerSlot }: { contentSlot?: ReactNode; footerSlot?: ReactNode }) => (
    <div className="message-header">
      <div className="message-body-column">
        {contentSlot && <div className="message-body-content">{contentSlot}</div>}
        {footerSlot && <div className="message-footer-slot">{footerSlot}</div>}
      </div>
    </div>
  )),
  MessageMenuBar: vi.fn(() => <div className="message-menubar">menubar</div>),
  MessageOutline: vi.fn(() => null),
  messageListActions: vi.fn(),
  messageListSelection: vi.fn(),
  messageListEditingId: vi.fn()
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
  usePreference: () => {
    throw new Error('MessageGroup should consume provider renderConfig instead of usePreference')
  }
}))

vi.mock('@renderer/components/HorizontalScrollContainer', () => ({
  default: mocks.HorizontalScrollContainer
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
    classNames: (...values: unknown[]) => flattenClassNames(values).join(' '),
    cn: (...values: unknown[]) => flattenClassNames(values).join(' '),
    isEmoji: () => false
  }
})

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: null,
    setModel: vi.fn()
  })
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../frame/MessageContent', () => ({
  default: mocks.MessageContent
}))

vi.mock('../frame/MessageErrorBoundary', () => ({
  default: mocks.MessageErrorBoundary
}))

vi.mock('../list/MessageGroupMenuBar', () => ({
  default: mocks.MessageGroupMenuBar
}))

vi.mock('../MessageListProvider', () => ({
  useMessageListActions: () => mocks.messageListActions(),
  useMessageRenderConfig: () => {
    const settings = mocks.settings()

    return {
      userName: '',
      narrowMode: false,
      messageStyle: settings.messageStyle,
      messageFont: settings.messageFont,
      fontSize: settings.fontSize,
      renderInputMessageAsMarkdown: false,
      codeFancyBlock: true,
      thoughtAutoCollapse: true,
      mathEnableSingleDollar: false,
      showMessageOutline: settings.showMessageOutline,
      multiModelMessageStyle: settings.multiModelMessageStyle,
      multiModelGridColumns: settings.gridColumns,
      multiModelGridPopoverTrigger: settings.gridPopoverTrigger
    }
  },
  useMessageListSelection: () => mocks.messageListSelection(),
  useMessageListEditingId: () => mocks.messageListEditingId(),
  useMessageListMeta: () => ({
    userProfile: { avatar: '' }
  }),
  useMessageListUi: () => ({}),
  useMessageListUiSelectors: () => ({}),
  useMessageListUiStatic: () => ({})
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

const createMessage = (id: string, index: number, multiModelMessageStyle: MultiModelMessageStyle) =>
  ({
    id,
    parentId: 'ask-1',
    role: 'assistant',
    topicId: 'topic-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success',
    multiModelMessageStyle,
    index
  }) as MessageListItem & { index: number; multiModelMessageStyle: MultiModelMessageStyle }

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
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'horizontal',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })
    mocks.messageListActions.mockReturnValue({
      setActiveBranch: vi.fn(),
      deleteMessageGroup: vi.fn(),
      regenerateMessage: vi.fn(),
      updateMessageUiState: vi.fn()
    })
    mocks.messageListSelection.mockReturnValue(undefined)
    mocks.messageListEditingId.mockReturnValue(null)
  })

  it('does not apply horizontal padding on the message element itself', () => {
    const messages = [createMessage('msg-1', 0, 'vertical')]
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup isLatestAssistantGroup messages={messages} topic={topic} />)
    const messageElement = container.querySelector('#message-msg-1 .message')

    expect(messageElement).not.toHaveClass('px-4')
  })

  it('adds padding to grouped grid message cards', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'grid',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })
    const messages = [createMessage('msg-1', 0, 'grid'), createMessage('msg-2', 1, 'grid')]
    const topic = { id: 'topic-1' } as Topic

    render(<MessageGroup messages={messages} topic={topic} />)

    const gridCard = document.getElementById('message-msg-1')

    expect(gridCard).toHaveClass('grid', 'p-2.5', '[&.grid_.message]:pt-0')
  })

  it('adds fixed-height flex constraints for horizontal and grid message cards', () => {
    const topic = { id: 'topic-1' } as Topic

    const { rerender } = render(
      <MessageGroup
        messages={[createMessage('horizontal-1', 0, 'horizontal'), createMessage('horizontal-2', 1, 'horizontal')]}
        topic={topic}
      />
    )

    const horizontalCard = document.getElementById('message-horizontal-1')
    expect(horizontalCard).toHaveClass(
      '[&.horizontal_.message-header]:h-full',
      '[&.horizontal_.message-body-column]:min-h-0',
      '[&.horizontal_.message-body-content]:flex-1'
    )

    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'grid',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })

    rerender(
      <MessageGroup messages={[createMessage('grid-1', 0, 'grid'), createMessage('grid-2', 1, 'grid')]} topic={topic} />
    )

    const gridCard = document.getElementById('message-grid-1')
    expect(gridCard).toHaveClass(
      '[&.grid_.message-header]:h-full',
      '[&.grid_.message-body-column]:min-h-0',
      '[&.grid_.message-body-content]:flex-1'
    )
  })

  it('renders assistant content inside the message body column', () => {
    const messages = [createMessage('msg-1', 0, 'vertical')]
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup messages={messages} topic={topic} />)

    const contentContainer = container.querySelector('#message-msg-1 .message-content-container') as HTMLElement
    const bodyColumn = container.querySelector('#message-msg-1 .message-body-column')

    expect(contentContainer.closest('.message-body-column')).toBe(bodyColumn)
    expect(contentContainer.style.marginLeft).toBe('')
    expect(contentContainer.style.width).toBe('')
  })

  it('renders assistant footer actions in the same message body column as content', () => {
    const messages = [createMessage('msg-1', 0, 'vertical')]
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup messages={messages} topic={topic} />)

    const contentContainer = container.querySelector('#message-msg-1 .message-content-container') as HTMLElement
    const footer = container.querySelector('#message-msg-1 .MessageFooter') as HTMLElement

    expect(footer.closest('.message-body-column')).toBe(contentContainer.closest('.message-body-column'))
    expect(footer.style.marginLeft).toBe('')
    expect(footer.style.width).toBe('')
  })

  it('keeps the latest assistant footer visible', () => {
    const messages = [createMessage('msg-1', 0, 'vertical')]
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup isLatestAssistantGroup messages={messages} topic={topic} />)

    const footer = container.querySelector('#message-msg-1 .MessageFooter')

    expect(footer).toHaveClass('opacity-100')
    expect(footer).not.toHaveClass('opacity-0')
  })

  it('hides non-latest assistant footers until hover or focus', () => {
    const messages = [createMessage('msg-1', 0, 'vertical')]
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup isLatestAssistantGroup={false} messages={messages} topic={topic} />)

    const footer = container.querySelector('#message-msg-1 .MessageFooter')

    expect(footer).toHaveClass('opacity-0', 'group-hover/message:opacity-100', 'focus-within:opacity-100')
    expect(footer).not.toHaveClass('opacity-100')
  })

  it('keeps vertical scrolling inside the message content area for horizontal layout', () => {
    const messages = [createMessage('msg-1', 0, 'horizontal'), createMessage('msg-2', 1, 'horizontal')]
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup messages={messages} topic={topic} />)

    const outerWrapper = document.getElementById('message-msg-1')
    expect(outerWrapper).not.toBeNull()
    expect(getComputedStyle(outerWrapper!).overflowY).toBe('visible')

    expect(outerWrapper).toHaveClass('[&.horizontal_.message]:p-2.5')

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

  it('keeps user message footer actions hidden by default without a divider', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'vertical',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })

    const message = {
      ...createMessage('user-1', 0, 'vertical'),
      role: 'user'
    } as MessageListItem & { index: number; multiModelMessageStyle: MultiModelMessageStyle }
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup messages={[message]} topic={topic} />)

    const footer = container.querySelector('#message-user-1 .MessageFooter')
    const actions = footer?.querySelector('.message-menubar')?.parentElement

    expect(footer?.closest('.message-body-column')).not.toBeNull()
    expect((footer as HTMLElement).style.marginLeft).toBe('')
    expect((footer as HTMLElement).style.width).toBe('')
    expect(footer).not.toHaveClass('opacity-0')
    expect(footer?.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(actions).toHaveClass('opacity-0', 'group-hover/message:opacity-100')
  })

  it('wraps the edited plain user message region with an editing outline', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'vertical',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })
    const message = {
      ...createMessage('user-editing-1', 0, 'vertical'),
      role: 'user'
    } as MessageListItem & { index: number; multiModelMessageStyle: MultiModelMessageStyle }
    mocks.messageListEditingId.mockReturnValue('user-editing-1')

    const { container } = render(<MessageGroup messages={[message]} topic={{ id: 'topic-1' } as Topic} />)

    const messageElement = container.querySelector('#message-user-editing-1 .message')

    expect(mocks.MessageContent).toHaveBeenCalled()
    expect(messageElement).toHaveAttribute('aria-disabled', 'true')
    expect(messageElement).toHaveClass(
      'opacity-70',
      '[outline:1px_solid_var(--color-border)]',
      'outline-offset-[-1px]',
      'bg-muted'
    )
    expect(container).not.toHaveTextContent('chat.message.editing_current')
    expect(container.querySelector('#message-user-editing-1 .message-editing-hint')).toBeNull()
    expect(container.querySelector('#message-user-editing-1 .message-menubar')).toBeNull()
  })

  it('passes locked mentioned models into the editing snapshot', async () => {
    const startEditing = vi.fn()
    let runtime: { startEditing: () => void } | undefined
    mocks.messageListActions.mockReturnValue({
      setActiveBranch: vi.fn(),
      deleteMessageGroup: vi.fn(),
      editMessage: vi.fn(),
      startEditing,
      regenerateMessage: vi.fn(),
      updateMessageUiState: vi.fn(),
      bindMessageRuntime: vi.fn((_id, nextRuntime) => {
        runtime = nextRuntime as { startEditing: () => void }
        return vi.fn()
      })
    })
    const userMessage = {
      ...createMessage('user-1', 0, 'vertical'),
      parentId: 'root',
      role: 'user'
    } as MessageListItem & { index: number; multiModelMessageStyle: MultiModelMessageStyle }
    const lockedMentionedModels = [
      {
        id: 'provider-a::model-a',
        name: 'Model A',
        providerId: 'provider-a',
        apiModelId: 'model-a',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      },
      {
        id: 'provider-b::model-b',
        name: 'Model B',
        providerId: 'provider-b',
        apiModelId: 'model-b',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      }
    ] satisfies Model[]

    render(
      <MessageGroup
        directAssistantModelsByUserId={new Map([['user-1', lockedMentionedModels]])}
        messages={[userMessage]}
        topic={{ id: 'topic-1' } as Topic}
      />
    )
    await waitFor(() => expect(runtime).toBeDefined())

    act(() => {
      runtime?.startEditing()
    })

    expect(startEditing).toHaveBeenCalledWith(
      userMessage,
      expect.any(Array),
      expect.objectContaining({
        lockedMentionedModels: [
          expect.objectContaining({ id: 'provider-a::model-a', name: 'Model A', providerId: 'provider-a' }),
          expect.objectContaining({ id: 'provider-b::model-b', name: 'Model B', providerId: 'provider-b' })
        ]
      })
    )
    expect(startEditing.mock.calls[0][2].lockedMentionedModels).toHaveLength(2)
  })

  it('wraps the edited bubble user message region with an editing outline', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'vertical',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'bubble',
      showMessageOutline: false
    })
    const message = {
      ...createMessage('user-bubble-editing-1', 0, 'vertical'),
      role: 'user'
    } as MessageListItem & { index: number; multiModelMessageStyle: MultiModelMessageStyle }
    mocks.messageListEditingId.mockReturnValue('user-bubble-editing-1')

    const { container } = render(<MessageGroup messages={[message]} topic={{ id: 'topic-1' } as Topic} />)
    const messageElement = container.querySelector('#message-user-bubble-editing-1 .message')

    expect(messageElement).toHaveAttribute('aria-disabled', 'true')
    expect(messageElement).toHaveClass(
      'opacity-70',
      '[outline:1px_solid_var(--color-border)]',
      'outline-offset-[-1px]',
      'bg-muted'
    )
    expect(container).not.toHaveTextContent('chat.message.editing_current')
    expect(container.querySelector('#message-user-bubble-editing-1 .message-editing-hint')).toBeNull()
    expect(container.querySelector('#message-user-bubble-editing-1 .message-menubar')).toBeNull()
  })

  it('applies inline enter motion to newly inserted non-bubble user messages', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'vertical',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })

    const message = {
      ...createMessage('user-inline-1', 0, 'vertical'),
      role: 'user'
    } as MessageListItem & { index: number; multiModelMessageStyle: MultiModelMessageStyle }
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(
      <MessageEnterMotionProvider enteringMessageIds={new Set(['user-inline-1'])}>
        <MessageGroup messages={[message]} topic={topic} />
      </MessageEnterMotionProvider>
    )

    const messageElement = container.querySelector('#message-user-inline-1 .message')

    expect(messageElement).toHaveAttribute('data-message-enter-motion', 'user-inline')
    expect(messageElement).toHaveClass('animation-chat-message-enter-inline')
  })

  it('keeps user bubble content and footer out of the assistant title-column offset', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'vertical',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'bubble',
      showMessageOutline: false
    })

    const message = {
      ...createMessage('user-bubble-1', 0, 'vertical'),
      role: 'user'
    } as MessageListItem & { index: number; multiModelMessageStyle: MultiModelMessageStyle }
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup messages={[message]} topic={topic} />)

    const contentContainer = container.querySelector('#message-user-bubble-1 .message-content-container') as HTMLElement
    const contentRow = contentContainer.parentElement?.parentElement as HTMLElement
    const avatar = container.querySelector('#message-user-bubble-1 .message-avatar') as HTMLElement
    const footer = container.querySelector('#message-user-bubble-1 .MessageFooter') as HTMLElement

    expect(container.querySelector('#message-user-bubble-1 .message-body-column')).toBeNull()
    expect(contentRow).toHaveClass('items-start')
    expect(avatar).toHaveClass('mt-1.5')
    expect(contentContainer.style.marginLeft).toBe('')
    expect(contentContainer.style.width).toBe('')
    expect(footer.style.marginLeft).toBe('')
    expect(footer).toHaveClass('w-[calc(100%-30px)]')
  })

  it('applies bubble enter motion to newly inserted bubble user messages', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'vertical',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'bubble',
      showMessageOutline: false
    })

    const message = {
      ...createMessage('user-bubble-1', 0, 'vertical'),
      role: 'user'
    } as MessageListItem & { index: number; multiModelMessageStyle: MultiModelMessageStyle }
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(
      <MessageEnterMotionProvider enteringMessageIds={new Set(['user-bubble-1'])}>
        <MessageGroup messages={[message]} topic={topic} />
      </MessageEnterMotionProvider>
    )

    const messageElement = container.querySelector('#message-user-bubble-1 .message')

    expect(messageElement).toHaveAttribute('data-message-enter-motion', 'user-bubble')
    expect(messageElement).toHaveClass('animation-chat-message-enter-bubble')
  })

  it('renders user messages with the normal card layout in multi-select mode', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'vertical',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'bubble',
      showMessageOutline: false
    })
    mocks.messageListSelection.mockReturnValue({
      enabled: true,
      isMultiSelectMode: true,
      selectedMessageIds: []
    })

    const message = {
      ...createMessage('user-multi-select-1', 0, 'vertical'),
      role: 'user'
    } as MessageListItem & { index: number; multiModelMessageStyle: MultiModelMessageStyle }
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup messages={[message]} topic={topic} />)

    expect(container.querySelector('#message-user-multi-select-1 .message-body-column')).not.toBeNull()
    expect(container.querySelector('#message-user-multi-select-1 .MessageFooter')).toBeNull()
    expect(container.querySelector('#message-user-multi-select-1 .message')).toHaveClass('cursor-pointer')
  })

  it('selects a message when clicking message content in multi-select mode', () => {
    const selectMessage = vi.fn()
    mocks.messageListActions.mockReturnValue({
      selectMessage,
      updateMessageUiState: vi.fn()
    })
    mocks.messageListSelection.mockReturnValue({
      enabled: true,
      isMultiSelectMode: true,
      selectedMessageIds: []
    })

    const messages = [createMessage('msg-1', 0, 'vertical')]
    const topic = { id: 'topic-1' } as Topic

    const { container } = render(<MessageGroup messages={messages} topic={topic} />)

    const contentContainer = container.querySelector('#message-msg-1 .message-content-container') as HTMLElement
    fireEvent.click(contentContainer)

    expect(selectMessage).toHaveBeenCalledWith('msg-1', true)
    const multiSelectContainers = Array.from(container.querySelectorAll<HTMLElement>('.multi-select-mode'))
    const contentEventsContainer = multiSelectContainers.find((element) =>
      element.className.includes('[&.multi-select-mode_.message-content-container]:pointer-events-none')
    )

    expect(multiSelectContainers[0]).toHaveClass('multi-select-mode')
    expect(contentEventsContainer).toHaveClass('[&.multi-select-mode_.message-content-container]:pointer-events-none')
  })

  it('shows multi-model group controls even when the provider has no write actions', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'fold',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })
    mocks.messageListActions.mockReturnValue({
      updateMessageUiState: vi.fn()
    })

    const messages = [createMessage('msg-1', 0, 'fold'), createMessage('msg-2', 1, 'fold')]
    const topic = { id: 'topic-1' } as Topic

    render(<MessageGroup messages={messages} topic={topic} />)

    expect(mocks.MessageGroupMenuBar).toHaveBeenCalled()
  })

  it('notifies parent layout when multi-model group style changes', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'fold',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })
    const onMultiModelMessageStyleChange = vi.fn()
    const updateMessageUiState = vi.fn()
    mocks.messageListActions.mockReturnValue({
      updateMessageUiState
    })
    const messages = [createMessage('msg-1', 0, 'fold'), createMessage('msg-2', 1, 'fold')]
    const topic = { id: 'topic-1' } as Topic

    render(
      <MessageGroup messages={messages} topic={topic} onMultiModelMessageStyleChange={onMultiModelMessageStyleChange} />
    )

    const lastMenuCall = mocks.MessageGroupMenuBar.mock.calls.at(-1) as unknown as [
      {
        setMultiModelMessageStyle: (style: MultiModelMessageStyle) => void
      }
    ]
    const menuProps = lastMenuCall[0]
    act(() => {
      menuProps.setMultiModelMessageStyle('horizontal')
    })

    expect(onMultiModelMessageStyleChange).toHaveBeenCalledWith('horizontal')
    expect(updateMessageUiState).toHaveBeenCalledWith('msg-1', { multiModelMessageStyle: 'horizontal' })
    expect(updateMessageUiState).toHaveBeenCalledWith('msg-2', { multiModelMessageStyle: 'horizontal' })
  })

  it('selects a newly added assistant sibling in fold layout', async () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'fold',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })
    const updateMessageUiState = vi.fn()
    mocks.messageListActions.mockReturnValue({
      setActiveBranch: vi.fn(),
      updateMessageUiState
    })

    const messages = [createMessage('msg-1', 0, 'fold'), createMessage('msg-2', 1, 'fold')]
    const newModelMessage = {
      ...createMessage('msg-3', 2, 'fold'),
      createdAt: '2026-01-01T00:00:01.000Z',
      status: 'pending'
    } as MessageListItem & { index: number; multiModelMessageStyle: MultiModelMessageStyle }
    const topic = { id: 'topic-1' } as Topic

    const { rerender } = render(<MessageGroup messages={messages} topic={topic} />)

    rerender(<MessageGroup messages={[...messages, newModelMessage]} topic={topic} />)

    await waitFor(() => {
      expect(mocks.MessageGroupMenuBar).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selectMessageId: 'msg-3'
        }),
        undefined
      )
    })
    expect(updateMessageUiState).toHaveBeenCalledWith('msg-3', { foldSelected: true })
  })

  it('follows the active branch message when a multi-model group keeps the same columns', async () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'fold',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })
    const updateMessageUiState = vi.fn()
    mocks.messageListActions.mockReturnValue({
      setActiveBranch: vi.fn(),
      updateMessageUiState
    })

    const messages = [
      { ...createMessage('model-a', 0, 'fold'), isActiveBranch: true },
      { ...createMessage('model-b', 1, 'fold'), isActiveBranch: false }
    ]
    const topic = { id: 'topic-1' } as Topic

    const { rerender } = render(<MessageGroup messages={messages} topic={topic} />)

    rerender(
      <MessageGroup
        messages={[
          { ...messages[0], isActiveBranch: false },
          { ...messages[1], isActiveBranch: true }
        ]}
        topic={topic}
      />
    )

    await waitFor(() => {
      expect(mocks.MessageGroupMenuBar).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selectMessageId: 'model-b'
        }),
        undefined
      )
    })
    expect(updateMessageUiState).toHaveBeenCalledWith('model-a', { foldSelected: false })
    expect(updateMessageUiState).toHaveBeenCalledWith('model-b', { foldSelected: true })
  })
})
