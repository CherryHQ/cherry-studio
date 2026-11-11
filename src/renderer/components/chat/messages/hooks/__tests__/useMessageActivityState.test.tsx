import { act, render, renderHook, screen } from '@testing-library/react'
import { type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MessageListProvider,
  useAnyMessageListItemProcessing
} from '@renderer/components/chat/messages/MessageListProvider'
import {
  defaultMessageRenderConfig,
  type MessageListItem,
  type MessageListProviderValue
} from '@renderer/components/chat/messages/types'

import { KeyedMessageActivityStore, useMessageActivityState } from '../useMessageActivityState'

const streamStatus = vi.hoisted(() => ({
  status: undefined as 'pending' | 'streaming' | 'done' | 'aborted' | 'error' | 'awaiting-approval' | undefined,
  activeExecutions: [] as Array<{ anchorMessageId: string }>,
  awaitingApprovalAnchors: [] as Array<{ anchorMessageId: string }>
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => streamStatus
}))

const createMessage = (id: string, status: MessageListItem['status'] = 'success'): MessageListItem => ({
  id,
  role: 'assistant',
  topicId: 'topic-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  status
})

function createProviderValue(messages: MessageListItem[], store: KeyedMessageActivityStore): MessageListProviderValue {
  return {
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
      messageActivityStore: store,
      getMessageActivityState: store.getSnapshot
    },
    actions: {},
    meta: { selectionLayer: false }
  }
}

const renderCounts = new Map<string, number>()

const AnyProcessingProbe = ({ messages }: { messages: MessageListItem[] }) => {
  const isProcessing = useAnyMessageListItemProcessing(messages)
  return <div data-testid="any-processing">{String(isProcessing)}</div>
}

function renderWithProvider(value: MessageListProviderValue, children: ReactNode) {
  return render(<MessageListProvider value={value}>{children}</MessageListProvider>)
}

describe('KeyedMessageActivityStore', () => {
  beforeEach(() => renderCounts.clear())

  it('notifies only messages whose execution or approval state changed', () => {
    const store = new KeyedMessageActivityStore()
    const onFirstMessageChange = vi.fn()
    const onSecondMessageChange = vi.fn()
    store.subscribe(createMessage('message-1'), onFirstMessageChange)
    store.subscribe(createMessage('message-2'), onSecondMessageChange)

    store.update(['message-1'], [], undefined)

    expect(onFirstMessageChange).toHaveBeenCalledTimes(1)
    expect(onSecondMessageChange).not.toHaveBeenCalled()
    expect(store.getSnapshot(createMessage('message-1'))).toEqual({
      isProcessing: true,
      isStreamTarget: true,
      isApprovalAnchor: false,
      isActiveTurnProcessing: true,
      isStreamLive: false
    })

    store.update([], ['message-1'], undefined)

    expect(onFirstMessageChange).toHaveBeenCalledTimes(2)
    expect(onSecondMessageChange).not.toHaveBeenCalled()
    expect(store.getSnapshot(createMessage('message-1'))).toEqual({
      isProcessing: true,
      isStreamTarget: true,
      isApprovalAnchor: true,
      isActiveTurnProcessing: true,
      isStreamLive: false
    })

    store.update(['message-1'], ['message-1'], undefined)
    store.update([], ['message-1'], undefined)

    expect(onFirstMessageChange).toHaveBeenCalledTimes(2)
    expect(onSecondMessageChange).not.toHaveBeenCalled()
  })

  it('skips snapshot derivation for subscribers whose keyed inputs did not change', () => {
    const store = new KeyedMessageActivityStore()
    const message = createMessage('message-1')
    let statusReads = 0
    Object.defineProperty(message, 'status', {
      get: () => {
        statusReads += 1
        return 'success'
      }
    })
    store.subscribe(message, vi.fn())
    statusReads = 0

    store.update(['message-2'], [], undefined)

    expect(statusReads).toBe(0)
  })

  it('keeps snapshots stable and preserves persisted pending state', () => {
    const store = new KeyedMessageActivityStore()
    const pendingMessage = createMessage('message-1', 'pending')

    const firstSnapshot = store.getSnapshot(pendingMessage)

    expect(store.getSnapshot(pendingMessage)).toBe(firstSnapshot)
    expect(firstSnapshot).toEqual({
      isProcessing: true,
      isStreamTarget: true,
      isApprovalAnchor: false,
      isActiveTurnProcessing: true,
      isStreamLive: true
    })
  })

  it('publishes live and terminal turn state only to the active message', () => {
    const store = new KeyedMessageActivityStore()
    const activeMessage = createMessage('message-1')
    const unrelatedMessage = createMessage('message-2')
    const onActiveMessageChange = vi.fn()
    const onUnrelatedMessageChange = vi.fn()
    store.subscribe(activeMessage, onActiveMessageChange)
    store.subscribe(unrelatedMessage, onUnrelatedMessageChange)

    store.update(['message-1'], [], 'streaming')

    expect(store.getSnapshot(activeMessage)).toMatchObject({
      isActiveTurnProcessing: true,
      isStreamLive: true
    })
    expect(onActiveMessageChange).toHaveBeenCalledTimes(1)
    expect(onUnrelatedMessageChange).not.toHaveBeenCalled()

    store.update(['message-1'], [], 'done')

    expect(store.getSnapshot(activeMessage)).toMatchObject({
      isProcessing: true,
      isActiveTurnProcessing: false,
      isStreamLive: false
    })
    expect(onActiveMessageChange).toHaveBeenCalledTimes(2)
    expect(onUnrelatedMessageChange).not.toHaveBeenCalled()
  })

  it('clears the previous stream status when a new topic has no status', () => {
    const store = new KeyedMessageActivityStore()
    const activeMessage = createMessage('message-1')

    store.syncTopic('topic-1', ['message-1'], [], 'done')
    expect(store.getSnapshot(activeMessage).isActiveTurnProcessing).toBe(false)

    store.syncTopic('topic-2', ['message-1'], [], undefined)

    expect(store.getSnapshot(activeMessage).isActiveTurnProcessing).toBe(true)
  })

  it('updates the aggregate processing snapshot used by list virtualization', () => {
    const store = new KeyedMessageActivityStore()
    const messages = [createMessage('message-1'), createMessage('message-2')]

    renderWithProvider(createProviderValue(messages, store), <AnyProcessingProbe messages={messages} />)
    expect(screen.getByTestId('any-processing')).toHaveTextContent('false')

    act(() => store.update([], ['message-2'], undefined))
    expect(screen.getByTestId('any-processing')).toHaveTextContent('true')

    act(() => store.update([], [], undefined))
    expect(screen.getByTestId('any-processing')).toHaveTextContent('false')
  })
})

describe('useMessageActivityState', () => {
  beforeEach(() => {
    streamStatus.status = undefined
    streamStatus.activeExecutions = []
    streamStatus.awaitingApprovalAnchors = []
  })

  it('keeps the capability stable while publishing keyed activity updates', () => {
    const { result, rerender } = renderHook(() => useMessageActivityState('topic-1'))
    const initialCapability = result.current
    const onFirstMessageChange = vi.fn()
    const onSecondMessageChange = vi.fn()
    initialCapability.store.subscribe(createMessage('message-1'), onFirstMessageChange)
    initialCapability.store.subscribe(createMessage('message-2'), onSecondMessageChange)

    streamStatus.status = 'streaming'
    streamStatus.activeExecutions = [{ anchorMessageId: 'message-1' }]
    act(() => rerender())

    expect(onFirstMessageChange).toHaveBeenCalledTimes(1)
    expect(onSecondMessageChange).not.toHaveBeenCalled()
    expect(result.current.store.getSnapshot(createMessage('message-1'))).toMatchObject({
      isProcessing: true,
      isActiveTurnProcessing: true,
      isStreamLive: true
    })
  })

  it('resets the keyed store when the topic changes', () => {
    const { result, rerender } = renderHook(({ topicId }) => useMessageActivityState(topicId), {
      initialProps: { topicId: 'topic-1' }
    })
    const firstStore = result.current.store

    streamStatus.activeExecutions = [{ anchorMessageId: 'message-1' }]
    act(() => rerender({ topicId: 'topic-1' }))
    expect(firstStore.getSnapshot(createMessage('message-1')).isProcessing).toBe(true)

    streamStatus.activeExecutions = []
    act(() => rerender({ topicId: 'topic-2' }))

    expect(result.current.store.getSnapshot(createMessage('message-1')).isProcessing).toBe(false)
  })
})
