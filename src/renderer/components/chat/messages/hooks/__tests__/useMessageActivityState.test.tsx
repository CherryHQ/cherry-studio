import {
  MessageListProvider,
  useAnyMessageListItemProcessing,
  useMessageListItemActivityState
} from '@renderer/components/chat/messages/MessageListProvider'
import {
  defaultMessageRenderConfig,
  type MessageListItem,
  type MessageListProviderValue
} from '@renderer/components/chat/messages/types'
import { act, render, renderHook, screen } from '@testing-library/react'
import { memo, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const ActivityProbe = memo(({ message }: { message: MessageListItem }) => {
  renderCounts.set(message.id, (renderCounts.get(message.id) ?? 0) + 1)
  const state = useMessageListItemActivityState(message)
  return <div data-testid={message.id}>{`${state.isProcessing}:${state.isApprovalAnchor}`}</div>
})

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

    store.update(['message-1'], [])

    expect(onFirstMessageChange).toHaveBeenCalledTimes(1)
    expect(onSecondMessageChange).not.toHaveBeenCalled()
    expect(store.getSnapshot(createMessage('message-1'))).toEqual({
      isProcessing: true,
      isStreamTarget: true,
      isApprovalAnchor: false,
      isActiveTurnProcessing: true,
      isStreamLive: false
    })

    store.update([], ['message-1'])

    expect(onFirstMessageChange).toHaveBeenCalledTimes(2)
    expect(onSecondMessageChange).not.toHaveBeenCalled()
    expect(store.getSnapshot(createMessage('message-1'))).toEqual({
      isProcessing: true,
      isStreamTarget: true,
      isApprovalAnchor: true,
      isActiveTurnProcessing: true,
      isStreamLive: false
    })

    store.update(['message-1'], ['message-1'])
    store.update([], ['message-1'])

    expect(onFirstMessageChange).toHaveBeenCalledTimes(2)
    expect(onSecondMessageChange).not.toHaveBeenCalled()
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

  it('re-renders only message subscribers whose derived state changed', () => {
    const store = new KeyedMessageActivityStore()
    const firstMessage = createMessage('message-1')
    const secondMessage = createMessage('message-2')
    const pendingMessage = createMessage('message-3', 'pending')
    const messages = [firstMessage, secondMessage, pendingMessage]

    renderWithProvider(
      createProviderValue(messages, store),
      messages.map((message) => <ActivityProbe key={message.id} message={message} />)
    )

    act(() => store.update(['message-1'], []))
    expect(renderCounts).toEqual(
      new Map([
        ['message-1', 2],
        ['message-2', 1],
        ['message-3', 1]
      ])
    )

    act(() => store.update(['message-2'], []))
    expect(renderCounts).toEqual(
      new Map([
        ['message-1', 3],
        ['message-2', 2],
        ['message-3', 1]
      ])
    )

    act(() => store.update([], ['message-2']))
    expect(renderCounts.get('message-1')).toBe(3)
    expect(renderCounts.get('message-2')).toBe(3)
    expect(renderCounts.get('message-3')).toBe(1)
    expect(screen.getByTestId('message-2')).toHaveTextContent('true:true')

    act(() => store.update(['message-3'], []))
    expect(renderCounts.get('message-3')).toBe(1)
  })

  it('updates the aggregate processing snapshot used by list virtualization', () => {
    const store = new KeyedMessageActivityStore()
    const messages = [createMessage('message-1'), createMessage('message-2')]

    renderWithProvider(createProviderValue(messages, store), <AnyProcessingProbe messages={messages} />)
    expect(screen.getByTestId('any-processing')).toHaveTextContent('false')

    act(() => store.update([], ['message-2']))
    expect(screen.getByTestId('any-processing')).toHaveTextContent('true')

    act(() => store.update([], []))
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

    expect(result.current).toBe(initialCapability)
    expect(result.current.getMessageActivityState).toBe(initialCapability.getMessageActivityState)
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

    expect(result.current.store).toBe(firstStore)
    expect(result.current.store.getSnapshot(createMessage('message-1')).isProcessing).toBe(false)
  })
})
