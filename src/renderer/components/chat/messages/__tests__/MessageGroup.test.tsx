import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type MessageHeaderComponent from '../frame/MessageHeader'
import type MessageMenuBarComponent from '../frame/MessageMenuBar'
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
  MessageContent: vi.fn(({ messageId, parts }: { messageId: string; parts: CherryMessagePart[] }) => (
    <div
      data-testid="message-parts-content"
      data-message-id={messageId}
      data-part-text={parts[0]?.type === 'text' ? parts[0].text : ''}
      style={{ minHeight: 600 }}>
      Long message content
    </div>
  )),
  MessageErrorBoundary: vi.fn(({ children }: { children: ReactNode }) => <>{children}</>),
  MessageHeader: vi.fn(({ contentSlot, footerSlot }: ComponentProps<typeof MessageHeaderComponent>) => (
    <div className="message-header">
      <div className="message-body-column">
        {contentSlot && <div className="message-body-content">{contentSlot}</div>}
        {footerSlot && <div className="message-footer-slot">{footerSlot}</div>}
      </div>
    </div>
  )),
  MessageMenuBar: vi.fn((props: ComponentProps<typeof MessageMenuBarComponent>) => (
    <div className="message-menubar" data-message-id={props.message.id}>
      menubar
    </div>
  )),
  MessageOutline: vi.fn(() => null),
  messageListActions: vi.fn(),
  messageListSelection: vi.fn(),
  messageListEditingId: vi.fn(),
  messageListUiSelectors: vi.fn()
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

vi.mock('@renderer/utils/style', () => {
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
    cn: (...values: unknown[]) => flattenClassNames(values).join(' ')
  }
})

vi.mock('@renderer/utils/naming', () => ({
  isEmoji: () => false
}))

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
    EDIT_MESSAGE: 'edit-message'
  },
  EventEmitter: mocks.EventEmitter
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

vi.mock('../frame/MessageContent', async () => {
  const { useMessageParts } = await import('../blocks/MessagePartsContext')

  function MessageContentMock({ message }: { message: MessageListItem }) {
    const parts = useMessageParts(message.id)
    return mocks.MessageContent({ messageId: message.id, parts })
  }

  return {
    default: MessageContentMock
  }
})

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
  useMessageListUiSelectors: () => mocks.messageListUiSelectors(),
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

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

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

const expectEveryMessageHeaderToShowModelIdentity = (expected: boolean) => {
  expect(mocks.MessageHeader.mock.calls.length).toBeGreaterThan(0)
  expect(mocks.MessageHeader.mock.calls.every(([props]) => props.showModelIdentity === expected)).toBe(true)
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
    mocks.messageListUiSelectors.mockReturnValue({})
  })

  it('renders a clear-context divider and routes clicks through the injected action', () => {
    const startNewContext = vi.fn()
    mocks.messageListActions.mockReturnValue({
      setActiveBranch: vi.fn(),
      deleteMessageGroup: vi.fn(),
      regenerateMessage: vi.fn(),
      updateMessageUiState: vi.fn(),
      startNewContext
    })
    const message = {
      id: 'clear-1',
      parentId: 'message-1',
      role: 'user',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success',
      isContextBoundary: true
    } as MessageListItem

    render(<MessageGroup messages={[message]} />)

    fireEvent.click(screen.getByText('chat.message.new.context'))
    expect(startNewContext).toHaveBeenCalledOnce()
    expect(mocks.MessageContent).not.toHaveBeenCalled()
  })

  it('renders the clear-context divider as disabled when its action is unavailable', () => {
    const message = {
      id: 'clear-1',
      parentId: 'message-1',
      role: 'user',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'success',
      isContextBoundary: true
    } as MessageListItem

    render(<MessageGroup messages={[message]} />)

    const divider = screen.getByText('chat.message.new.context').closest('.clear-context-divider')
    expect(divider).toHaveAttribute('aria-disabled', 'true')
  })

  it('passes updated parts when only the parts map changes', () => {
    const messages = [createMessage('msg-1', 0, 'vertical')]
    const initialParts = [{ type: 'text', text: 'initial' }] as CherryMessagePart[]
    const updatedParts = [{ type: 'text', text: 'updated' }] as CherryMessagePart[]

    const { getByTestId, rerender } = render(
      <MessageGroup messages={messages} partsByMessageId={{ 'msg-1': initialParts }} />
    )

    expect(getByTestId('message-parts-content')).toHaveAttribute('data-part-text', 'initial')

    rerender(<MessageGroup messages={messages} partsByMessageId={{ 'msg-1': updatedParts }} />)

    expect(getByTestId('message-parts-content')).toHaveAttribute('data-part-text', 'updated')
  })

  it.each(['vertical', 'grid'] as const)(
    'always shows each model identity in %s multi-model layout',
    (multiModelMessageStyle) => {
      mocks.settings.mockReturnValue({
        multiModelMessageStyle,
        gridColumns: 2,
        gridPopoverTrigger: 'click',
        messageFont: 'system',
        fontSize: 14,
        messageStyle: 'plain',
        showMessageOutline: false
      })
      const messages = [
        createMessage('msg-1', 0, multiModelMessageStyle),
        createMessage('msg-2', 1, multiModelMessageStyle)
      ]

      render(<MessageGroup messages={messages} />)

      expectEveryMessageHeaderToShowModelIdentity(true)
    }
  )

  it('uses two equal columns across the full width in grid layout', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'grid',
      gridColumns: 5,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })
    const messages = [
      createMessage('msg-1', 0, 'grid'),
      createMessage('msg-2', 1, 'grid'),
      createMessage('msg-3', 2, 'grid')
    ]

    const { container } = render(<MessageGroup messages={messages} />)

    const grid = container.querySelector('[data-ui="chat.message.group"] > .grid') as HTMLElement
    expect(grid).toHaveClass('w-full')
    expect(grid.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
  })

  it('keeps model identity in the existing selector for fold layout', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'fold',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })
    const messages = [createMessage('msg-1', 0, 'fold'), createMessage('msg-2', 1, 'fold')]

    render(<MessageGroup messages={messages} />)

    expectEveryMessageHeaderToShowModelIdentity(false)
  })

  it('keeps model identity visible while selecting messages in a multi-model layout', () => {
    mocks.messageListSelection.mockReturnValue({ isMultiSelectMode: true, selectedMessageIds: [] })
    const messages = [createMessage('msg-1', 0, 'vertical'), createMessage('msg-2', 1, 'vertical')]

    render(<MessageGroup messages={messages} />)

    expectEveryMessageHeaderToShowModelIdentity(true)
  })

  it('renders assistant content inside the message body column', () => {
    const messages = [createMessage('msg-1', 0, 'vertical')]

    const { container } = render(<MessageGroup messages={messages} />)

    const contentContainer = container.querySelector('#message-msg-1 .message-content-container') as HTMLElement
    const bodyColumn = container.querySelector('#message-msg-1 .message-body-column')

    expect(contentContainer).toHaveAttribute('data-ui', expect.stringContaining('part:message-content'))
    expect(contentContainer.closest('.message-body-column')).toBe(bodyColumn)
    expect(contentContainer.style.marginLeft).toBe('')
    expect(contentContainer.style.width).toBe('')
  })

  it('renders adapter-owned tail content only after its target assistant message', () => {
    const messages = [createMessage('msg-1', 0, 'vertical'), createMessage('msg-2', 1, 'vertical')]

    const { container } = render(
      <MessageGroup
        messages={messages}
        messageTail={{ messageId: 'msg-2', content: <div data-testid="message-tail">background tasks</div> }}
      />
    )

    expect(container.querySelector('#message-msg-1 [data-testid="message-tail"]')).toBeNull()
    expect(container.querySelector('#message-msg-2 [data-testid="message-tail"]')).toHaveTextContent('background tasks')
  })

  it('moves adapter-owned tail content without leaving the previous message memoized', () => {
    const messages = [createMessage('msg-1', 0, 'vertical'), createMessage('msg-2', 1, 'vertical')]
    const tailContent = <div data-testid="message-tail">background tasks</div>
    const { container, rerender } = render(
      <MessageGroup messages={messages} messageTail={{ messageId: 'msg-1', content: tailContent }} />
    )

    rerender(<MessageGroup messages={messages} messageTail={{ messageId: 'msg-2', content: tailContent }} />)

    expect(container.querySelector('#message-msg-1 [data-testid="message-tail"]')).toBeNull()
    expect(container.querySelector('#message-msg-2 [data-testid="message-tail"]')).toHaveTextContent('background tasks')
    expect(container.querySelectorAll('[data-testid="message-tail"]')).toHaveLength(1)
  })

  it('renders assistant footer actions in the same message body column as content', () => {
    const messages = [createMessage('msg-1', 0, 'vertical')]

    const { container } = render(<MessageGroup messages={messages} />)

    const contentContainer = container.querySelector('#message-msg-1 .message-content-container') as HTMLElement
    const footer = container.querySelector('#message-msg-1 .MessageFooter') as HTMLElement

    expect(footer.closest('.message-body-column')).toBe(contentContainer.closest('.message-body-column'))
  })

  it('keeps the latest assistant footer visible', () => {
    const messages = [createMessage('msg-1', 0, 'vertical')]

    const { container } = render(<MessageGroup isLatestAssistantGroup messages={messages} />)

    const footer = container.querySelector('#message-msg-1 .MessageFooter')

    expect(footer).toHaveClass('opacity-100')
    expect(footer).not.toHaveClass('opacity-0')
  })

  it('reveals historical assistant footers on hover or keyboard focus', () => {
    const messages = [createMessage('msg-1', 0, 'vertical')]

    const { container } = render(<MessageGroup isLatestAssistantGroup={false} messages={messages} />)

    const footer = container.querySelector('#message-msg-1 .MessageFooter')

    expect(footer).toHaveClass('opacity-0', 'group-hover/message:opacity-100', 'focus-within:opacity-100')
    expect(footer).not.toHaveClass('opacity-100')
  })

  it('keeps vertical scrolling inside the message content area for horizontal layout', () => {
    const messages = [createMessage('msg-1', 0, 'horizontal'), createMessage('msg-2', 1, 'horizontal')]

    const { container } = render(<MessageGroup messages={messages} />)

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

    const { container } = render(
      <div onWheel={parentWheel}>
        <MessageGroup messages={messages} />
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

    const { container } = render(<MessageGroup messages={messages} />)

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

    const { container } = render(<MessageGroup messages={messages} />)

    const contentContainer = container.querySelector('#message-msg-1 .message-content-container')
    expect(contentContainer).not.toBeNull()
    expect(getComputedStyle(contentContainer as HTMLElement).overflowY).toBe('visible')
  })

  it('does not update message UI state from capture mode renders', async () => {
    const updateMessageUiState = vi.fn()
    mocks.messageListActions.mockReturnValue({
      setActiveBranch: vi.fn(),
      deleteMessageGroup: vi.fn(),
      regenerateMessage: vi.fn(),
      updateMessageUiState
    })
    const firstMessage = createMessage('msg-1', 0, 'fold')
    const secondMessage = createMessage('msg-2', 1, 'fold')

    const { rerender } = render(<MessageGroup captureMode messages={[firstMessage]} />)
    rerender(<MessageGroup captureMode messages={[firstMessage, secondMessage]} />)

    await waitFor(() => {
      expect(updateMessageUiState).not.toHaveBeenCalled()
    })
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

    const { container } = render(<MessageGroup messages={[message]} />)

    const messageElement = container.querySelector('#message-user-editing-1 .message')

    expect(mocks.MessageContent).toHaveBeenCalled()
    expect(messageElement).toHaveAttribute('aria-disabled', 'true')
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

  it('does not start editing an assistant reply while its translation is active', async () => {
    const startEditing = vi.fn()
    let runtime: { startEditing: () => void } | undefined
    mocks.messageListActions.mockReturnValue({
      editMessage: vi.fn(),
      startEditing,
      bindMessageRuntime: vi.fn((_id, nextRuntime) => {
        runtime = nextRuntime as { startEditing: () => void }
        return vi.fn()
      })
    })
    mocks.messageListUiSelectors.mockReturnValue({
      isMessageTranslating: (messageId: string) => messageId === 'assistant-1'
    })
    const assistantMessage = createMessage('assistant-1', 0, 'vertical')

    render(
      <MessageGroup
        messages={[assistantMessage]}
        partsByMessageId={{ 'assistant-1': [{ type: 'text', text: 'answer' }] as CherryMessagePart[] }}
      />
    )
    await waitFor(() => expect(runtime).toBeDefined())

    act(() => {
      runtime?.startEditing()
    })

    expect(startEditing).not.toHaveBeenCalled()
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

    const { container } = render(<MessageGroup messages={[message]} />)
    const messageElement = container.querySelector('#message-user-bubble-editing-1 .message')

    expect(messageElement).toHaveAttribute('aria-disabled', 'true')
    expect(container).not.toHaveTextContent('chat.message.editing_current')
    expect(container.querySelector('#message-user-bubble-editing-1 .message-editing-hint')).toBeNull()
    expect(container.querySelector('#message-user-bubble-editing-1 .message-menubar')).toBeNull()
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

    const { container } = render(<MessageGroup messages={messages} />)

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

    render(<MessageGroup messages={messages} />)

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

    render(<MessageGroup messages={messages} onMultiModelMessageStyleChange={onMultiModelMessageStyleChange} />)

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

    const { rerender } = render(<MessageGroup messages={messages} />)

    rerender(<MessageGroup messages={[...messages, newModelMessage]} />)

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

    const { rerender } = render(<MessageGroup messages={messages} />)

    rerender(
      <MessageGroup
        messages={[
          { ...messages[0], isActiveBranch: false },
          { ...messages[1], isActiveBranch: true }
        ]}
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

  it('shows the context indicator on the active branch instead of stale useful UI state', () => {
    mocks.settings.mockReturnValue({
      multiModelMessageStyle: 'grid',
      gridColumns: 2,
      gridPopoverTrigger: 'click',
      messageFont: 'system',
      fontSize: 14,
      messageStyle: 'plain',
      showMessageOutline: false
    })
    mocks.messageListUiSelectors.mockReturnValue({
      getMessageUiState: (messageId: string) => ({ useful: messageId === 'model-a' })
    })

    const messages = [
      { ...createMessage('model-a', 0, 'grid'), isActiveBranch: false },
      { ...createMessage('model-b', 1, 'grid'), isActiveBranch: true }
    ]

    render(<MessageGroup messages={messages} />)

    const contextIndicatorCalls = mocks.MessageHeader.mock.calls
      .map(([props]) => ({ messageId: props.message.id, isGroupContextMessage: props.isGroupContextMessage }))
      .filter(({ isGroupContextMessage }) => isGroupContextMessage !== undefined)
    expect(contextIndicatorCalls).toEqual([
      { messageId: 'model-a', isGroupContextMessage: false },
      { messageId: 'model-b', isGroupContextMessage: true }
    ])
  })

  it('changes the active branch when a grouped reply is selected for context', async () => {
    const setActiveBranch = vi.fn()
    mocks.messageListActions.mockReturnValue({
      setActiveBranch,
      updateMessageUiState: vi.fn()
    })
    const messages = [createMessage('model-a', 0, 'grid'), createMessage('model-b', 1, 'grid')]

    render(<MessageGroup messages={messages} />)

    const modelBMenuProps = mocks.MessageMenuBar.mock.calls
      .map(([props]) => props)
      .find((props) => props.message.id === 'model-b')
    expect(modelBMenuProps).toBeDefined()

    act(() => modelBMenuProps?.onSelectContext?.('model-b'))

    await waitFor(() => {
      expect(setActiveBranch).toHaveBeenCalledWith('model-b')
    })
  })

  it('applies rapid context selections in click order so the last selection wins', async () => {
    const firstSelection = createDeferred()
    const setActiveBranch = vi.fn((messageId: string) =>
      messageId === 'model-b' ? firstSelection.promise : Promise.resolve()
    )
    mocks.messageListActions.mockReturnValue({
      setActiveBranch,
      updateMessageUiState: vi.fn()
    })
    const messages = [
      { ...createMessage('model-a', 0, 'grid'), isActiveBranch: true },
      { ...createMessage('model-b', 1, 'grid'), isActiveBranch: false }
    ]

    render(<MessageGroup messages={messages} />)

    const menuPropsByMessageId = new Map(
      mocks.MessageMenuBar.mock.calls.map(([props]) => [props.message.id, props] as const)
    )
    act(() => menuPropsByMessageId.get('model-b')?.onSelectContext?.('model-b'))
    act(() => menuPropsByMessageId.get('model-a')?.onSelectContext?.('model-a'))

    await waitFor(() => {
      expect(setActiveBranch).toHaveBeenCalledTimes(1)
      expect(setActiveBranch).toHaveBeenLastCalledWith('model-b')
    })

    await act(async () => firstSelection.resolve())

    await waitFor(() => {
      expect(setActiveBranch).toHaveBeenNthCalledWith(2, 'model-a')
    })
  })
})
