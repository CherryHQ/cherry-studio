import { captureScrollable, captureScrollableAsDataUrl } from '@renderer/utils/image'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatBottomOverlayInsetProvider } from '../../layout/ChatViewportInsetContext'
import type { MessageVirtualListHandle } from '../list/MessageVirtualList'
import MessageList from '../MessageList'
import { MessageListProvider } from '../MessageListProvider'
import {
  defaultMessageRenderConfig,
  type MessageListActions,
  type MessageListItem,
  type MessageListProviderValue,
  type MessageListRuntime
} from '../types'

const scrollToBottom = vi.fn()
const scrollToTop = vi.fn()
const scrollToKey = vi.fn()
const scrollToElement = vi.fn()
const scrollToRange = vi.fn()
const messageVirtualListMocks = vi.hoisted(() => ({
  deferScrollContainerReady: false,
  navigationBaseKey: null as string | null,
  renderItemLimit: undefined as number | undefined,
  readyCallbacks: [] as ((element: HTMLDivElement) => void)[],
  scrollElement: null as HTMLDivElement | null
}))
const messageGroupRenderCounts = vi.hoisted(() => new Map<string, number>())
const messageGroupMountCounts = vi.hoisted(() => new Map<string, number>())
const messageOutlineModule = vi.hoisted(() => ({ loaded: false }))
const messageListSearchMock = vi.hoisted(() => ({
  props: null as {
    messages: MessageListItem[]
    excludedMessageIds: ReadonlySet<string>
    isStreaming: boolean
  } | null
}))
const chatLayoutModeMock = vi.hoisted(() => ({
  setForceWideLayout: () => {},
  setRailGutter: vi.fn(),
  getRailGutterPx: vi.fn(() => 0)
}))
const originalLanguage = i18n.language

beforeAll(async () => {
  await i18n.changeLanguage('en-US')
})

afterAll(async () => {
  await i18n.changeLanguage(originalLanguage)
})

vi.mock('@renderer/components/chat/layout/ChatLayoutModeContext', () => ({
  useChatLayoutMode: () => chatLayoutModeMock
}))

vi.mock('@renderer/components/chat/HtmlArtifactView', async () => {
  const { useHtmlArtifactPopupContext } = await import('@renderer/components/chat/HtmlArtifactPopupContext')

  return {
    HtmlArtifactPopupOutlet: () => {
      const { popupSession } = useHtmlArtifactPopupContext()
      return popupSession ? (
        <div role="dialog" aria-label={`${popupSession.title} popup`}>
          {popupSession.html}
        </div>
      ) : null
    }
  }
})

vi.mock('@renderer/components/icons/LoadingIcon', () => ({
  default: () => <div data-testid="loading-icon" />
}))

vi.mock('@renderer/components/chat/messages/MultiSelectActionPopup', () => ({
  __esModule: true,
  default: () => null
}))

vi.mock('@renderer/components/SelectionContextMenu', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    clearTimeoutTimer: vi.fn(),
    setTimeoutTimer: (_key: string, callback: () => void) => callback()
  })
}))

vi.mock('@renderer/utils/image', () => ({
  captureScrollable: vi.fn(),
  captureScrollableAsDataUrl: vi.fn()
}))

vi.mock('@renderer/utils/style', () => ({
  classNames: (value: unknown) => {
    if (Array.isArray(value)) {
      return value
        .flatMap((item) => {
          if (typeof item === 'string') return [item]
          if (item && typeof item === 'object') {
            return Object.entries(item as Record<string, boolean>)
              .filter(([, enabled]) => enabled)
              .map(([className]) => className)
          }
          return []
        })
        .join(' ')
    }
    return ''
  }
}))

vi.mock('@renderer/utils/file', () => ({
  removeSpecialCharactersForFileName: (value: string) => value
}))

vi.mock('../layout/NarrowLayout', () => ({
  __esModule: true,
  default: ({
    children,
    narrowMode,
    withSidePadding,
    ...props
  }: {
    children: ReactNode
    narrowMode?: boolean
    withSidePadding?: boolean
  } & HTMLAttributes<HTMLDivElement>) => {
    void narrowMode
    void withSidePadding
    return <div {...props}>{children}</div>
  }
}))

vi.mock('../frame/MessageOutline', () => {
  messageOutlineModule.loaded = true
  return {
    __esModule: true,
    default: () => null
  }
})

vi.mock('../layout/MessageListLoading', () => ({
  MessageListInitialLoading: () => <div data-testid="message-list-loading" />
}))

vi.mock('../list/MessageAnchorLine', () => ({
  __esModule: true,
  default: () => null
}))

vi.mock('../list/MessageGroup', async () => {
  const React = await import('react')
  const { useHtmlArtifactPopupContext } = await import('@renderer/components/chat/HtmlArtifactPopupContext')
  const ArtifactLifecycleControl = () => {
    const popupContext = useHtmlArtifactPopupContext()
    const artifactId = 'artifact-1'
    const html = '<script>interactive()</script>'
    const isApproved = popupContext.approvedInteractiveHtmlById[artifactId] === html

    return isApproved ? (
      <button
        type="button"
        onClick={() =>
          popupContext.openPopup({
            artifactId,
            html,
            title: 'Interactive artifact',
            editable: false,
            kind: 'document',
            zoom: 100
          })
        }>
        Open artifact
      </button>
    ) : (
      <button type="button" onClick={() => popupContext.approveInteractiveHtml(artifactId, html)}>
        Approve artifact
      </button>
    )
  }
  const MockMessageGroup = ({
    messages,
    registerMessageElement
  }: {
    messages: MessageListItem[]
    registerMessageElement?: (id: string, element: HTMLElement | null) => void
  }) => {
    const groupId = messages.map((message) => message.id).join(',')
    messageGroupRenderCounts.set(groupId, (messageGroupRenderCounts.get(groupId) ?? 0) + 1)
    const mountGroupIdRef = React.useRef(groupId)
    React.useEffect(() => {
      const mountGroupId = mountGroupIdRef.current
      messageGroupMountCounts.set(mountGroupId, (messageGroupMountCounts.get(mountGroupId) ?? 0) + 1)
    }, [])

    return (
      <div data-testid="message-group">
        {messages.map((message) => {
          const setRef = (element: HTMLDivElement | null) => {
            registerMessageElement?.(message.id, element)
          }
          return (
            <div
              id={`message-${message.id}`}
              key={message.id}
              ref={setRef}
              className="fold"
              data-testid={`message-node-${message.id}`}
            />
          )
        })}
        {messages.some((message) => message.id === 'artifact-source') && <ArtifactLifecycleControl />}
        {groupId}
      </div>
    )
  }

  return {
    __esModule: true,
    default: MockMessageGroup
  }
})

vi.mock('../list/MessageListSearch', () => ({
  MessageListSearch: (props: NonNullable<typeof messageListSearchMock.props>) => {
    messageListSearchMock.props = props
    return <div data-testid="message-list-search" />
  }
}))

vi.mock('../list/SelectionBox', () => ({
  __esModule: true,
  default: () => null
}))

vi.mock('../list/MessageVirtualList', async () => {
  const React = await import('react')
  return {
    MESSAGE_VIRTUAL_LIST_DEFAULT_BOTTOM_PADDING_PX: 12,
    MESSAGE_VIRTUAL_LIST_DEFAULT_TOP_PADDING_PX: 6,
    MessageVirtualList: ({
      handleRef,
      items,
      keepMountedKeys,
      onScrollContainerReady,
      renderItem,
      scrollToBottomButtonBottomOffset,
      showScrollToBottomButton,
      topPadding
    }: any) => {
      const renderedScrollElementRef = React.useRef<HTMLDivElement | null>(null)
      React.useImperativeHandle(
        handleRef as Ref<MessageVirtualListHandle>,
        () => ({
          scrollToBottom,
          scrollToTop,
          scrollToKey,
          scrollToElement,
          scrollToRange,
          getNavigationBaseKey: () => messageVirtualListMocks.navigationBaseKey,
          isFollowing: () => false,
          getScrollElement: () => messageVirtualListMocks.scrollElement
        }),
        []
      )
      React.useEffect(() => {
        if (!onScrollContainerReady) return
        if (messageVirtualListMocks.deferScrollContainerReady) {
          messageVirtualListMocks.readyCallbacks.push(onScrollContainerReady)
          return
        }
        const scrollElement = messageVirtualListMocks.scrollElement ?? renderedScrollElementRef.current
        if (scrollElement) {
          onScrollContainerReady(scrollElement)
        }
      }, [onScrollContainerReady])

      const visibleItems = items.slice(0, messageVirtualListMocks.renderItemLimit ?? items.length)

      return (
        <div
          ref={renderedScrollElementRef}
          data-keep-mounted-keys={(keepMountedKeys ?? []).join(',')}
          data-scroll-to-bottom-button-bottom-offset={scrollToBottomButtonBottomOffset ?? ''}
          data-scroll-to-bottom-button-enabled={String(Boolean(showScrollToBottomButton))}
          data-testid="virtual-list"
          data-top-padding={topPadding}>
          {visibleItems.map((item: unknown, index: number) => (
            <div key={index}>{renderItem(item, index)}</div>
          ))}
        </div>
      )
    }
  }
})

const createMessage = (
  id: string,
  role: MessageListItem['role'],
  status: MessageListItem['status'] = 'success'
): MessageListItem => ({
  id,
  role,
  topicId: 'topic-1',
  createdAt: '2026-01-01T00:00:00Z',
  status
})

const createValue = (
  messages: MessageListItem[],
  overrides?: Partial<MessageListProviderValue['state']>,
  actionOverrides?: Partial<MessageListActions>,
  metaOverrides?: Partial<MessageListProviderValue['meta']>
): MessageListProviderValue => ({
  state: {
    topic: { id: 'topic-1', name: 'Topic' } as MessageListProviderValue['state']['topic'],
    messages,
    partsByMessageId: {},
    messageNavigation: 'none',
    estimateSize: 400,
    overscan: 0,
    loadOlderDelayMs: 0,
    loadingResetDelayMs: 0,
    renderConfig: defaultMessageRenderConfig,
    ...overrides
  },
  actions: actionOverrides ?? {},
  meta: { selectionLayer: false, ...metaOverrides }
})

const renderMessageList = (messages: MessageListItem[]) =>
  render(
    <MessageListProvider value={createValue(messages)}>
      <MessageList />
    </MessageListProvider>
  )

describe('MessageList', () => {
  beforeEach(() => {
    scrollToBottom.mockClear()
    scrollToTop.mockClear()
    scrollToKey.mockReset()
    scrollToElement.mockClear()
    scrollToRange.mockClear()
    vi.mocked(captureScrollable).mockReset()
    vi.mocked(captureScrollableAsDataUrl).mockReset()
    messageVirtualListMocks.deferScrollContainerReady = false
    messageVirtualListMocks.navigationBaseKey = null
    messageVirtualListMocks.renderItemLimit = undefined
    messageVirtualListMocks.readyCallbacks = []
    messageVirtualListMocks.scrollElement = document.createElement('div')
    messageGroupRenderCounts.clear()
    messageGroupMountCounts.clear()
    messageListSearchMock.props = null
    chatLayoutModeMock.setRailGutter.mockReset()
    chatLayoutModeMock.getRailGutterPx.mockReset().mockReturnValue(0)
  })

  it('does not load the message outline module while outline is disabled', () => {
    renderMessageList([createMessage('assistant-1', 'assistant')])

    expect(messageOutlineModule.loaded).toBe(false)
  })

  it('exposes a stable message-list boundary', () => {
    const { container } = renderMessageList([createMessage('assistant-1', 'assistant')])

    expect(container.querySelector('[data-ui~="chat.message-list"]')).toHaveAttribute('id', 'messages')
  })

  it('keeps rapid navigation moving through assistant and user group owners', async () => {
    const user = userEvent.setup()
    const userMessage1 = createMessage('user-1', 'user')
    const assistantMessage1 = { ...createMessage('assistant-1', 'assistant'), parentId: userMessage1.id }
    const userMessage2 = createMessage('user-2', 'user')
    const assistantMessage2 = { ...createMessage('assistant-2', 'assistant'), parentId: userMessage2.id }
    const userMessage3 = createMessage('user-3', 'user')
    const assistantMessage3 = { ...createMessage('assistant-3', 'assistant'), parentId: userMessage3.id }
    messageVirtualListMocks.navigationBaseKey = `assistant${userMessage3.id}`
    messageVirtualListMocks.scrollElement = null
    scrollToKey.mockImplementationOnce((key: string) => {
      messageVirtualListMocks.navigationBaseKey = key
    })

    render(
      <MessageListProvider
        value={createValue(
          [userMessage1, assistantMessage1, userMessage2, assistantMessage2, userMessage3, assistantMessage3],
          { messageNavigation: 'buttons' }
        )}>
        <MessageList />
      </MessageListProvider>
    )

    const scrollElement = screen.getByTestId('virtual-list')
    scrollElement.getBoundingClientRect = vi.fn(() => ({
      bottom: 500,
      height: 500,
      left: 0,
      right: 500,
      top: 0,
      width: 500,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }))
    fireEvent.mouseMove(scrollElement, { clientX: 470, clientY: 250 })

    await user.click(screen.getByRole('button', { name: 'Previous Message' }))
    await user.click(screen.getByRole('button', { name: 'Previous Message' }))

    expect(scrollToKey.mock.calls).toEqual([
      [`user${userMessage2.id}`, 'start'],
      [`user${userMessage1.id}`, 'start']
    ])
  })

  it('keeps artifact popup and approval state when the source virtual row unmounts', async () => {
    const user = userEvent.setup()
    const sourceMessage = createMessage('artifact-source', 'assistant')
    const renderTree = () => (
      <MessageListProvider value={createValue([sourceMessage])}>
        <MessageList />
      </MessageListProvider>
    )
    const view = render(renderTree())

    await user.click(screen.getByRole('button', { name: 'Approve artifact' }))
    await user.click(screen.getByRole('button', { name: 'Open artifact' }))
    expect(await screen.findByRole('dialog', { name: 'Interactive artifact popup' })).toHaveTextContent(
      '<script>interactive()</script>'
    )

    messageVirtualListMocks.renderItemLimit = 0
    view.rerender(renderTree())

    expect(screen.queryByRole('button', { name: 'Open artifact' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Interactive artifact popup' })).toBeInTheDocument()

    messageVirtualListMocks.renderItemLimit = undefined
    view.rerender(renderTree())

    expect(screen.getByRole('button', { name: 'Open artifact' })).toBeInTheDocument()
  })

  it('keeps search disabled for embedded lists unless explicitly enabled', () => {
    renderMessageList([createMessage('assistant-1', 'assistant')])

    expect(screen.queryByTestId('message-list-search')).not.toBeInTheDocument()
  })

  it('keeps search mounted while excluding pending and live message content', () => {
    const completed = createMessage('assistant-completed', 'assistant')
    const pending = createMessage('assistant-pending', 'assistant', 'pending')
    const live = createMessage('assistant-live', 'assistant')

    render(
      <MessageListProvider
        value={createValue([completed, pending, live], {
          streamingLayers: {
            historyPartsByMessageId: {},
            liveMessageIds: [live.id]
          }
        })}>
        <MessageList enableSearch />
      </MessageListProvider>
    )

    expect(screen.getByTestId('message-list-search')).toBeInTheDocument()
    expect(messageListSearchMock.props?.messages.map((message) => message.id)).toEqual([
      completed.id,
      pending.id,
      live.id
    ])
    expect(messageListSearchMock.props?.excludedMessageIds.has(live.id)).toBe(true)
    expect(messageListSearchMock.props?.isStreaming).toBe(true)
  })

  it('pads the message column with the inherited rail gutter property', () => {
    renderMessageList([createMessage('assistant-1', 'assistant')])

    // The browser resolves the inherited property without a MessageGroup render.
    expect(screen.getByTestId('message-group').parentElement).toHaveStyle({
      paddingLeft: 'calc(24px + var(--chat-rail-gutter, 0px))',
      paddingRight: 'calc(24px + var(--chat-rail-gutter, 0px))'
    })
  })

  it('preserves the measured rail gutter when the message list unmounts', () => {
    Object.defineProperty(messageVirtualListMocks.scrollElement!, 'clientWidth', { value: 820 })
    const view = render(
      <MessageListProvider
        value={createValue([createMessage('assistant-1', 'assistant')], { messageNavigation: 'anchor' })}>
        <MessageList />
      </MessageListProvider>
    )

    expect(chatLayoutModeMock.setRailGutter).toHaveBeenCalledWith(24, 1)

    chatLayoutModeMock.setRailGutter.mockClear()
    view.unmount()

    expect(chatLayoutModeMock.setRailGutter).not.toHaveBeenCalled()
  })

  it('keeps historical groups sealed while only the live tail changes', () => {
    const topic = { id: 'topic-1', name: 'Topic' } as MessageListProviderValue['state']['topic']
    const historyUser = createMessage('user-history', 'user')
    const historyAssistant = createMessage('assistant-history', 'assistant')
    const liveAssistant = createMessage('assistant-live', 'assistant', 'pending')
    const historyParts = {
      'user-history': [{ type: 'text', text: 'question' }],
      'assistant-history': [{ type: 'text', text: 'sealed answer' }]
    } as MessageListProviderValue['state']['partsByMessageId']
    const streamingLayers = {
      historyPartsByMessageId: historyParts,
      liveMessageIds: ['assistant-live']
    } as NonNullable<MessageListProviderValue['state']['streamingLayers']>
    const actions: Partial<MessageListActions> = {}
    const buildValue = (text: string) =>
      createValue(
        [historyUser, historyAssistant, { ...liveAssistant }],
        {
          topic,
          streamingLayers,
          partsByMessageId: {
            ...historyParts,
            'assistant-live': [{ type: 'text', text }]
          } as MessageListProviderValue['state']['partsByMessageId']
        },
        actions
      )

    const view = render(
      <MessageListProvider value={buildValue('a')}>
        <MessageList />
      </MessageListProvider>
    )

    for (const text of ['ab', 'abc', 'abcd', 'abcde']) {
      view.rerender(
        <MessageListProvider value={buildValue(text)}>
          <MessageList />
        </MessageListProvider>
      )
    }

    expect(messageGroupRenderCounts.get('user-history')).toBe(1)
    expect(messageGroupRenderCounts.get('assistant-history')).toBe(1)
    expect(messageGroupRenderCounts.get('assistant-live')).toBe(5)
  })

  it('keeps historical groups sealed when the history parts map is rebuilt with unchanged entries', () => {
    const topic = { id: 'topic-1', name: 'Topic' } as MessageListProviderValue['state']['topic']
    const historyUser = createMessage('user-history', 'user')
    const historyAssistant = createMessage('assistant-history', 'assistant')
    const liveAssistant = createMessage('assistant-live', 'assistant', 'pending')
    const userParts = [{ type: 'text', text: 'question' }]
    const assistantParts = [{ type: 'text', text: 'sealed answer' }]
    const actions: Partial<MessageListActions> = {}
    const buildValue = () => {
      const historyParts = {
        'user-history': userParts,
        'assistant-history': assistantParts
      } as MessageListProviderValue['state']['partsByMessageId']
      return createValue(
        [historyUser, historyAssistant, liveAssistant],
        {
          topic,
          streamingLayers: {
            historyPartsByMessageId: historyParts,
            liveMessageIds: ['assistant-live']
          } as NonNullable<MessageListProviderValue['state']['streamingLayers']>,
          partsByMessageId: {
            ...historyParts,
            'assistant-live': [{ type: 'text', text: 'streaming' }]
          } as MessageListProviderValue['state']['partsByMessageId']
        },
        actions
      )
    }

    const view = render(
      <MessageListProvider value={buildValue()}>
        <MessageList />
      </MessageListProvider>
    )
    view.rerender(
      <MessageListProvider value={buildValue()}>
        <MessageList />
      </MessageListProvider>
    )

    expect(messageGroupRenderCounts.get('user-history')).toBe(1)
    expect(messageGroupRenderCounts.get('assistant-history')).toBe(1)
    expect(messageGroupRenderCounts.get('assistant-live')).toBe(2)
  })

  it('does not rerender or remount history while a new live id is waiting to join the list', () => {
    const topic = { id: 'topic-1', name: 'Topic' } as MessageListProviderValue['state']['topic']
    const historyUser = createMessage('user-history', 'user')
    const historyAssistant = createMessage('assistant-history', 'assistant')
    const historyParts = {
      'user-history': [{ type: 'text', text: 'question' }],
      'assistant-history': [{ type: 'text', text: 'answer with code' }]
    } as MessageListProviderValue['state']['partsByMessageId']
    const actions: Partial<MessageListActions> = {}
    const buildValue = (liveMessageIds: string[]) =>
      createValue(
        [historyUser, historyAssistant],
        {
          topic,
          streamingLayers: { historyPartsByMessageId: historyParts, liveMessageIds },
          partsByMessageId: historyParts
        },
        actions
      )

    const view = render(
      <MessageListProvider value={buildValue([])}>
        <MessageList />
      </MessageListProvider>
    )
    view.rerender(
      <MessageListProvider value={buildValue(['assistant-future'])}>
        <MessageList />
      </MessageListProvider>
    )

    expect(messageGroupRenderCounts.get('assistant-history')).toBe(1)
    expect(messageGroupRenderCounts.get('user-history')).toBe(1)
    expect(messageGroupMountCounts.get('assistant-history')).toBe(1)
    expect(messageGroupMountCounts.get('user-history')).toBe(1)
  })

  it('does not remount a group when it crosses from the live tail into history', () => {
    const historyUser = createMessage('user-history', 'user')
    const assistantParts = {
      'assistant-1': [{ type: 'text', text: 'answer' }]
    } as MessageListProviderValue['state']['partsByMessageId']
    const buildValue = (liveMessageIds: string[], status: MessageListItem['status']) =>
      createValue([historyUser, createMessage('assistant-1', 'assistant', status)], {
        streamingLayers: { historyPartsByMessageId: assistantParts, liveMessageIds },
        partsByMessageId: assistantParts
      })

    const view = render(
      <MessageListProvider value={buildValue(['assistant-1'], 'pending')}>
        <MessageList />
      </MessageListProvider>
    )
    view.rerender(
      <MessageListProvider value={buildValue([], 'success')}>
        <MessageList />
      </MessageListProvider>
    )

    expect(messageGroupMountCounts.get('assistant-1')).toBe(1)
    expect(messageGroupMountCounts.get('user-history')).toBe(1)
  })

  it('keeps the latest pending assistant group mounted', () => {
    renderMessageList([createMessage('user-1', 'user'), createMessage('assistant-1', 'assistant', 'pending')])

    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-keep-mounted-keys', 'assistantassistant-1')
    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-scroll-to-bottom-button-enabled', 'true')
  })

  it('keeps an active success-row assistant group mounted while approval owns the turn', () => {
    const assistant = createMessage('assistant-1', 'assistant', 'success')
    render(
      <MessageListProvider
        value={createValue([createMessage('user-1', 'user'), assistant], {
          getMessageActivityState: (message) => ({
            isApprovalAnchor: message.id === assistant.id,
            isProcessing: message.id === assistant.id,
            isStreamTarget: message.id === assistant.id
          })
        })}>
        <MessageList />
      </MessageListProvider>
    )

    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-keep-mounted-keys', 'assistantassistant-1')
  })

  it('keeps the scroll-to-bottom button enabled after assistant response completes', () => {
    renderMessageList([createMessage('user-1', 'user'), createMessage('assistant-1', 'assistant')])

    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-keep-mounted-keys', '')
    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-scroll-to-bottom-button-enabled', 'true')
  })

  it('uses bottom overlay padding as the scroll-to-bottom button offset', () => {
    render(
      <ChatBottomOverlayInsetProvider value={{ contentBottomPadding: 128, scrollerBottomMargin: 12 }}>
        <MessageListProvider value={createValue([createMessage('user-1', 'user')])}>
          <MessageList />
        </MessageListProvider>
      </ChatBottomOverlayInsetProvider>
    )

    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-scroll-to-bottom-button-bottom-offset', '128')
  })

  it('keeps existing messages visible while history refresh is loading', () => {
    render(
      <MessageListProvider
        value={createValue([createMessage('user-1', 'user'), createMessage('assistant-1', 'assistant')], {
          isInitialLoading: true
        })}>
        <MessageList />
      </MessageListProvider>
    )

    expect(screen.queryByTestId('message-list-loading')).toBeNull()
    expect(screen.getByTestId('virtual-list')).toHaveTextContent('user-1')
    expect(screen.getByTestId('virtual-list')).toHaveTextContent('assistant-1')
  })

  it('keeps the loading gate while stale cached messages are present', () => {
    render(
      <MessageListProvider
        value={createValue([createMessage('user-1', 'user'), createMessage('assistant-1', 'assistant')], {
          isInitialLoading: true,
          isMessagesStale: true
        })}>
        <MessageList />
      </MessageListProvider>
    )

    expect(screen.getByTestId('message-list-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('virtual-list')).toBeNull()
  })

  it('marks the message list container while multi-select mode is active', () => {
    render(
      <MessageListProvider
        value={createValue([createMessage('user-1', 'user')], {
          selection: {
            enabled: true,
            isMultiSelectMode: true,
            selectedMessageIds: []
          }
        })}>
        <MessageList />
      </MessageListProvider>
    )

    expect(document.getElementById('messages')).toHaveClass('messages-container', 'multi-select-mode')
  })

  it('keeps the list runtime bound while messages change', () => {
    let runtime: MessageListRuntime | undefined
    const unbindRuntime = vi.fn()
    const bindRuntime = vi.fn((nextRuntime: MessageListRuntime) => {
      runtime = nextRuntime
      return unbindRuntime
    })
    const firstMessage = createMessage('user-1', 'user')
    const nextMessage = createMessage('assistant-1', 'assistant')

    const view = render(
      <MessageListProvider value={createValue([firstMessage], undefined, { bindRuntime })}>
        <MessageList />
      </MessageListProvider>
    )

    expect(bindRuntime).toHaveBeenCalledTimes(1)

    view.rerender(
      <MessageListProvider value={createValue([firstMessage, nextMessage], undefined, { bindRuntime })}>
        <MessageList />
      </MessageListProvider>
    )

    expect(unbindRuntime).not.toHaveBeenCalled()
    expect(bindRuntime).toHaveBeenCalledTimes(1)

    runtime?.locateMessage(nextMessage.id)

    expect(scrollToKey).toHaveBeenCalledWith('assistantassistant-1', 'start')
  })

  it('does not register the message outline scroll listener while outline is disabled', () => {
    const addEventListenerSpy = vi.spyOn(messageVirtualListMocks.scrollElement!, 'addEventListener')

    renderMessageList([createMessage('assistant-1', 'assistant')])

    expect(addEventListenerSpy).not.toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true })
  })

  it('exports topic image from a complete non-virtualized capture surface', async () => {
    messageVirtualListMocks.renderItemLimit = 1
    const captureScrollableAsDataUrlMock = vi.mocked(captureScrollableAsDataUrl)
    const saveImage = vi.fn().mockResolvedValue(true)
    let runtime: MessageListRuntime | undefined
    const actions: Partial<MessageListActions> = {
      bindRuntime: (nextRuntime) => {
        runtime = nextRuntime
        return () => {
          runtime = undefined
        }
      },
      saveImage
    }

    captureScrollableAsDataUrlMock.mockImplementation(async (ref) => {
      const capturedText = ref.current?.textContent ?? ''
      expect(capturedText).toContain('user-1')
      expect(capturedText).toContain('assistant-1')
      expect(capturedText).toContain('user-2')
      return 'data:image/png;base64,topic'
    })

    render(
      <MessageListProvider
        value={createValue(
          [createMessage('user-1', 'user'), createMessage('assistant-1', 'assistant'), createMessage('user-2', 'user')],
          undefined,
          actions,
          { imageExportFileName: 'Topic' }
        )}>
        <MessageList />
      </MessageListProvider>
    )

    expect(screen.queryByText(/user-2/)).toBeNull()

    let exportPromise: Promise<void> | undefined
    act(() => {
      exportPromise = runtime?.exportTopicImage()
    })

    await act(async () => {
      await exportPromise
    })
    expect(saveImage).toHaveBeenCalledWith('Topic', 'data:image/png;base64,topic')
  })

  it('copies topic image from a complete non-virtualized capture surface', async () => {
    messageVirtualListMocks.renderItemLimit = 1
    const captureScrollableMock = vi.mocked(captureScrollable)
    const copyImage = vi.fn().mockResolvedValue(undefined)
    const imageBlob = new Blob(['topic'], { type: 'image/png' })
    let runtime: MessageListRuntime | undefined
    const actions: Partial<MessageListActions> = {
      bindRuntime: (nextRuntime) => {
        runtime = nextRuntime
        return () => {
          runtime = undefined
        }
      },
      copyImage
    }

    captureScrollableMock.mockImplementation(async (ref) => {
      const capturedText = ref.current?.textContent ?? ''
      expect(capturedText).toContain('user-1')
      expect(capturedText).toContain('assistant-1')
      expect(capturedText).toContain('user-2')
      return {
        toBlob: (callback: BlobCallback) => callback(imageBlob)
      } as unknown as HTMLCanvasElement
    })

    render(
      <MessageListProvider
        value={createValue(
          [createMessage('user-1', 'user'), createMessage('assistant-1', 'assistant'), createMessage('user-2', 'user')],
          undefined,
          actions
        )}>
        <MessageList />
      </MessageListProvider>
    )

    expect(screen.queryByText(/user-2/)).toBeNull()

    let copyPromise: Promise<void> | undefined
    act(() => {
      copyPromise = runtime?.copyTopicImage()
    })

    await act(async () => {
      await copyPromise
    })
    expect(copyImage).toHaveBeenCalledWith(imageBlob)
  })

  it('exports a pending topic image after the loading list scroll container is ready', async () => {
    messageVirtualListMocks.renderItemLimit = 0
    const captureScrollableAsDataUrlMock = vi.mocked(captureScrollableAsDataUrl)
    const saveImage = vi.fn().mockResolvedValue(true)
    let runtime: MessageListRuntime | undefined
    let exportResolved = false
    let exportPromise: Promise<void> | undefined
    const actions: Partial<MessageListActions> = {
      bindRuntime: (nextRuntime) => {
        runtime = nextRuntime
        return () => {
          runtime = undefined
        }
      },
      saveImage
    }

    captureScrollableAsDataUrlMock.mockImplementation(async (ref) => {
      const capturedText = ref.current?.textContent ?? ''
      expect(capturedText).toContain('user-1')
      expect(capturedText).toContain('assistant-1')
      return 'data:image/png;base64,topic'
    })

    const view = render(
      <MessageListProvider
        value={createValue([], { isInitialLoading: true }, actions, { imageExportFileName: 'Topic' })}>
        <MessageList />
      </MessageListProvider>
    )

    expect(runtime).toBeDefined()

    await act(async () => {
      exportPromise = runtime?.exportTopicImage().then(() => {
        exportResolved = true
      })
    })

    expect(exportResolved).toBe(false)
    expect(captureScrollableAsDataUrlMock).not.toHaveBeenCalled()
    expect(saveImage).not.toHaveBeenCalled()

    act(() => {
      view.rerender(
        <MessageListProvider
          value={createValue(
            [createMessage('user-1', 'user'), createMessage('assistant-1', 'assistant')],
            undefined,
            actions,
            { imageExportFileName: 'Topic' }
          )}>
          <MessageList />
        </MessageListProvider>
      )
    })

    await act(async () => {
      await exportPromise
    })
    expect(saveImage).toHaveBeenCalledWith('Topic', 'data:image/png;base64,topic')
    expect(exportResolved).toBe(true)
  })

  it('rejects a pending topic image export when the loading list unmounts before it is ready', async () => {
    const captureScrollableAsDataUrlMock = vi.mocked(captureScrollableAsDataUrl)
    captureScrollableAsDataUrlMock.mockClear()
    const saveImage = vi.fn().mockResolvedValue(true)
    let runtime: MessageListRuntime | undefined
    const actions: Partial<MessageListActions> = {
      bindRuntime: (nextRuntime) => {
        runtime = nextRuntime
        return () => {
          runtime = undefined
        }
      },
      saveImage
    }

    captureScrollableAsDataUrlMock.mockImplementation(async (ref) =>
      ref.current ? 'data:image/png;base64,topic' : undefined
    )

    const loadingView = render(
      <MessageListProvider
        value={createValue([], { isInitialLoading: true }, actions, { imageExportFileName: 'Topic' })}>
        <MessageList />
      </MessageListProvider>
    )

    const exportPromise = runtime?.exportTopicImage()

    loadingView.unmount()
    expect(saveImage).not.toHaveBeenCalled()
    await expect(exportPromise).rejects.toThrow('Topic image export was cancelled')

    render(
      <MessageListProvider
        value={createValue([createMessage('user-1', 'user')], undefined, actions, { imageExportFileName: 'Topic' })}>
        <MessageList />
      </MessageListProvider>
    )

    await vi.waitFor(() => {
      expect(captureScrollableAsDataUrlMock).not.toHaveBeenCalled()
    })
    expect(saveImage).not.toHaveBeenCalled()
  })

  it('exports a pending topic image when the scroll container becomes ready after runtime binding', async () => {
    messageVirtualListMocks.deferScrollContainerReady = true
    messageVirtualListMocks.scrollElement = null
    const captureScrollableAsDataUrlMock = vi.mocked(captureScrollableAsDataUrl)
    const saveImage = vi.fn().mockResolvedValue(true)
    let runtime: MessageListRuntime | undefined
    let exportResolved = false
    const actions: Partial<MessageListActions> = {
      bindRuntime: (nextRuntime) => {
        runtime = nextRuntime
        return () => {
          runtime = undefined
        }
      },
      saveImage
    }

    captureScrollableAsDataUrlMock.mockImplementation(async (ref) =>
      ref.current ? 'data:image/png;base64,topic' : undefined
    )

    render(
      <MessageListProvider
        value={createValue([createMessage('user-1', 'user')], undefined, actions, { imageExportFileName: 'Topic' })}>
        <MessageList />
      </MessageListProvider>
    )

    const exportPromise = runtime?.exportTopicImage().then(() => {
      exportResolved = true
    })

    expect(saveImage).not.toHaveBeenCalled()
    expect(exportResolved).toBe(false)

    const scrollElement = document.createElement('div')
    messageVirtualListMocks.scrollElement = scrollElement
    act(() => {
      for (const callback of messageVirtualListMocks.readyCallbacks.splice(0)) {
        callback(scrollElement)
      }
    })

    await act(async () => {
      await exportPromise
    })
    expect(saveImage).toHaveBeenCalledWith('Topic', 'data:image/png;base64,topic')
    expect(exportResolved).toBe(true)
  })

  it('rejects topic image export when capture does not produce image data', async () => {
    vi.mocked(captureScrollableAsDataUrl).mockResolvedValue(undefined)
    const saveImage = vi.fn().mockResolvedValue(true)
    let runtime: MessageListRuntime | undefined
    const actions: Partial<MessageListActions> = {
      bindRuntime: (nextRuntime) => {
        runtime = nextRuntime
        return () => {
          runtime = undefined
        }
      },
      saveImage
    }

    render(
      <MessageListProvider
        value={createValue([createMessage('user-1', 'user')], undefined, actions, { imageExportFileName: 'Topic' })}>
        <MessageList />
      </MessageListProvider>
    )

    let exportPromise: Promise<void> | undefined
    act(() => {
      exportPromise = runtime?.exportTopicImage()
    })

    await act(async () => {
      await expect(exportPromise).rejects.toThrow('Failed to capture topic image')
    })
    expect(saveImage).not.toHaveBeenCalled()
  })
})
