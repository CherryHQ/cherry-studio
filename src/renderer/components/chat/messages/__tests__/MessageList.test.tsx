import { TopicType } from '@renderer/types/topic'
import { captureScrollable, captureScrollableAsDataUrl } from '@renderer/utils/image'
import { act, render, screen } from '@testing-library/react'
import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const messageVirtualListMocks = vi.hoisted(() => ({
  deferScrollContainerReady: false,
  renderItemLimit: undefined as number | undefined,
  readyCallbacks: [] as ((element: HTMLDivElement) => void)[],
  scrollElement: null as HTMLDivElement | null
}))
const messageGroupRenderCounts = vi.hoisted(() => new Map<string, number>())

vi.mock('@renderer/components/chat/layout/ChatLayoutModeContext', () => ({
  useChatLayoutMode: () => ({ setForceWideLayout: vi.fn() })
}))

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

vi.mock('../frame/MessageOutline', () => ({
  __esModule: true,
  default: () => null
}))

vi.mock('../layout/MessageListLoading', () => ({
  MessageListInitialLoading: () => <div data-testid="message-list-loading" />
}))

vi.mock('../list/MessageAnchorLine', () => ({
  __esModule: true,
  default: () => null
}))

vi.mock('../list/MessageGroup', () => {
  const MockMessageGroup = ({
    messages,
    enteringMessageIds,
    registerMessageElement
  }: {
    messages: MessageListItem[]
    enteringMessageIds?: ReadonlySet<string>
    registerMessageElement?: (id: string, element: HTMLElement | null) => void
  }) => {
    const groupId = messages.map((message) => message.id).join(',')
    messageGroupRenderCounts.set(groupId, (messageGroupRenderCounts.get(groupId) ?? 0) + 1)

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
              data-testid={`message-node-${message.id}`}>
              <span data-testid={`message-enter-${message.id}`}>
                {String(enteringMessageIds?.has(message.id) ?? false)}
              </span>
            </div>
          )
        })}
        {groupId}
      </div>
    )
  }

  return {
    __esModule: true,
    default: MockMessageGroup
  }
})

vi.mock('../list/MessageNavigation', () => ({
  __esModule: true,
  default: () => null
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
      forceScrollToBottomKey,
      handleRef,
      items,
      keepMountedKeys,
      onScrollContainerReady,
      preserveScrollAnchor,
      renderItem,
      scrollToBottomButtonBottomOffset,
      showScrollToBottomButton,
      topPadding
    }: any) => {
      React.useImperativeHandle(
        handleRef as Ref<MessageVirtualListHandle>,
        () => ({
          scrollToBottom,
          scrollToTop,
          scrollToKey,
          scrollToElement,
          isAtBottom: () => false,
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
        if (messageVirtualListMocks.scrollElement) {
          onScrollContainerReady(messageVirtualListMocks.scrollElement)
        }
      }, [onScrollContainerReady])

      const visibleItems = items.slice(0, messageVirtualListMocks.renderItemLimit ?? items.length)

      return (
        <div
          data-force-scroll-key={forceScrollToBottomKey ?? ''}
          data-keep-mounted-keys={(keepMountedKeys ?? []).join(',')}
          data-preserve-scroll-anchor={String(Boolean(preserveScrollAnchor))}
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
    scrollToKey.mockClear()
    scrollToElement.mockClear()
    vi.mocked(captureScrollable).mockReset()
    vi.mocked(captureScrollableAsDataUrl).mockReset()
    messageVirtualListMocks.deferScrollContainerReady = false
    messageVirtualListMocks.renderItemLimit = undefined
    messageVirtualListMocks.readyCallbacks = []
    messageVirtualListMocks.scrollElement = document.createElement('div')
    messageGroupRenderCounts.clear()
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

  it('signals the virtual list to scroll after a user message is appended before an assistant placeholder', () => {
    const view = renderMessageList([createMessage('assistant-1', 'assistant')])
    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-force-scroll-key', '')

    act(() => {
      view.rerender(
        <MessageListProvider
          value={createValue([
            createMessage('assistant-1', 'assistant'),
            createMessage('user-1', 'user'),
            createMessage('assistant-placeholder', 'assistant')
          ])}>
          <MessageList />
        </MessageListProvider>
      )
    })

    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-force-scroll-key', 'useruser-1')
  })

  it('forces the latest user message to the viewport top for agent session topics', () => {
    render(
      <MessageListProvider
        value={createValue([createMessage('user-1', 'user'), createMessage('assistant-placeholder', 'assistant')], {
          topic: {
            id: 'session:session-1',
            name: 'Session',
            type: TopicType.Session
          } as MessageListProviderValue['state']['topic']
        })}>
        <MessageList />
      </MessageListProvider>
    )

    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-force-scroll-key', 'useruser-1')
  })

  it('does not signal forced scroll when an assistant message is appended', () => {
    const view = renderMessageList([createMessage('user-1', 'user')])
    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-force-scroll-key', 'useruser-1')

    act(() => {
      view.rerender(
        <MessageListProvider
          value={createValue([createMessage('user-1', 'user'), createMessage('assistant-1', 'assistant')])}>
          <MessageList />
        </MessageListProvider>
      )
    })

    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-force-scroll-key', 'useruser-1')
  })

  it('preserves the top anchor while the latest assistant response is pending', () => {
    renderMessageList([createMessage('user-1', 'user'), createMessage('assistant-1', 'assistant', 'pending')])

    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-preserve-scroll-anchor', 'true')
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

    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-preserve-scroll-anchor', 'true')
    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-keep-mounted-keys', 'assistantassistant-1')
  })

  it('keeps the scroll-to-bottom button enabled after assistant response completes', () => {
    renderMessageList([createMessage('user-1', 'user'), createMessage('assistant-1', 'assistant')])

    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-preserve-scroll-anchor', 'false')
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

  it('marks newly appended user and assistant messages for enter motion', () => {
    const view = renderMessageList([createMessage('user-1', 'user')])

    expect(screen.getByTestId('message-enter-user-1')).toHaveTextContent('false')

    act(() => {
      view.rerender(
        <MessageListProvider
          value={createValue([
            createMessage('user-1', 'user'),
            createMessage('user-2', 'user'),
            createMessage('assistant-placeholder', 'assistant')
          ])}>
          <MessageList />
        </MessageListProvider>
      )
    })

    expect(screen.getByTestId('message-enter-user-1')).toHaveTextContent('false')
    expect(screen.getByTestId('message-enter-user-2')).toHaveTextContent('true')
    expect(screen.getByTestId('message-enter-assistant-placeholder')).toHaveTextContent('true')
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

  it('limits message outline work to mounted message elements', () => {
    messageVirtualListMocks.renderItemLimit = 1
    const addEventListenerSpy = vi.spyOn(messageVirtualListMocks.scrollElement!, 'addEventListener')
    messageVirtualListMocks.scrollElement!.getBoundingClientRect = vi.fn(
      () =>
        ({
          bottom: 500,
          height: 500,
          left: 0,
          right: 500,
          top: 0,
          width: 500,
          x: 0,
          y: 0,
          toJSON: () => ({})
        }) as DOMRect
    )
    const getElementByIdSpy = vi.spyOn(document, 'getElementById')

    render(
      <MessageListProvider
        value={createValue(
          [
            createMessage('assistant-visible', 'assistant'),
            createMessage('assistant-unmounted-1', 'assistant'),
            createMessage('assistant-unmounted-2', 'assistant')
          ],
          {
            renderConfig: { ...defaultMessageRenderConfig, showMessageOutline: true }
          }
        )}>
        <MessageList />
      </MessageListProvider>
    )

    expect(addEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true })
    expect(getElementByIdSpy).not.toHaveBeenCalledWith('message-assistant-unmounted-1')
    expect(getElementByIdSpy).not.toHaveBeenCalledWith('message-assistant-unmounted-2')
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
