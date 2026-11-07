import { act, cleanup, render } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type ChatVirtualizerRuntime,
  type MessageVirtualListHandle,
  useChatVirtualizerRuntime
} from '@renderer/components/chat/messages/list/chatVirtualizerRuntime'
import { MessageListProvider, useMessageListActions } from '@renderer/components/chat/messages/MessageListProvider'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types/topic'

import AgentSessionMessages from '../../components/AgentSessionMessages'
import { useAgentMessageListProviderValue } from '../agentMessageListAdapter'

vi.mock('@renderer/components/chat/messages/MessageList', () => ({
  default: () => <ViewportProbe name="main" />
}))

// Export, menu and file capabilities are unrelated to the viewport ownership contract.
vi.mock('@renderer/components/chat/messages/hooks/useMessageListAdapterCapabilities', () => ({
  useMessageListAdapterCapabilities: () => ({
    errorActions: {},
    exportActions: {},
    headerCapabilities: {},
    leafCapabilities: {},
    messageUiStateCache: {},
    selectionController: { actions: {} }
  })
}))

const topic: Topic = {
  id: 'agent-session:session-a',
  assistantId: 'agent-1',
  name: 'Agent conversation',
  lastActivityAt: '2026-11-04T00:00:00.000Z',
  createdAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
  messages: []
}
const messages: [] = []
const partsByMessageId = {}
const items = ['assistant-message']
const getItemKey = (item: string) => item
const viewports = new Map<
  string,
  {
    runtime: ChatVirtualizerRuntime<string>
    handleRef: { current: MessageVirtualListHandle | null }
    unbind?: () => void
  }
>()
let scrollHeight: number

function ViewportProbe({ name }: { name: string }) {
  const handleRef = useRef<MessageVirtualListHandle>(null)
  const { bindRuntime } = useMessageListActions()
  const runtime = useChatVirtualizerRuntime({
    items,
    getItemKey,
    renderItem: (item) => item,
    hasMoreTop: false,
    topReachOverscanItems: 4,
    bottomPadding: 0,
    handleRef
  })
  useEffect(() => {
    const unbind = bindRuntime?.({
      scrollToBottom: runtime.scrollToBottom,
      locateMessage: () => {},
      copyTopicImage: async () => {},
      exportTopicImage: async () => {}
    })
    viewports.set(name, { runtime, handleRef, unbind: unbind ?? undefined })
    return unbind
  }, [bindRuntime, name, runtime])

  return (
    <div
      role="region"
      aria-label={`${name} messages`}
      ref={(element) => {
        runtime.scrollerRef.current = element
        if (!element) return
        Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight })
        Object.defineProperty(element, 'clientHeight', { configurable: true, value: 400 })
      }}>
      <div ref={runtime.contentRef}>Earlier conversation</div>
      <div ref={runtime.freezeSpacerRef} />
    </div>
  )
}

function AuxiliaryConversation({ capture = false }: { capture?: boolean }) {
  const provider = useAgentMessageListProviderValue({
    topic,
    messages,
    partsByMessageId,
    isLoading: false,
    messageNavigation: 'anchor',
    imageActionConsumer: capture ? 'capture' : undefined,
    ...(capture && { scrollToBottomOnSend: true })
  })
  return (
    <MessageListProvider value={provider}>
      <ViewportProbe name={capture ? 'capture' : 'tool-flow'} />
    </MessageListProvider>
  )
}

const primaryConversation = (
  <AgentSessionMessages
    agentId="agent-1"
    sessionId="session-a"
    messages={messages}
    partsByMessageId={partsByMessageId}
    isLoading={false}
  />
)

describe('Agent accepted-send viewport handoff', () => {
  const resizeCallbacks = new Set<ResizeObserverCallback>()
  const originalResizeObserver = globalThis.ResizeObserver

  beforeEach(() => {
    scrollHeight = 1200
    vi.spyOn(ipcApi, 'request').mockResolvedValue(undefined)
    globalThis.ResizeObserver = class {
      constructor(private callback: ResizeObserverCallback) {
        resizeCallbacks.add(callback)
      }
      observe() {}
      unobserve() {}
      disconnect() {
        resizeCallbacks.delete(this.callback)
      }
    }
  })

  afterEach(() => {
    cleanup()
    viewports.clear()
    resizeCallbacks.clear()
    globalThis.ResizeObserver = originalResizeObserver
    vi.restoreAllMocks()
  })

  function startReading(name = 'main') {
    const { runtime, handleRef } = viewports.get(name)!
    const scroller = runtime.scrollerRef.current!
    scroller.scrollTop = 500
    act(() => runtime.takeUserControl('user-scrolled-up'))
    expect(handleRef.current?.isFollowing()).toBe(false)
    return { scroller, handleRef }
  }

  function growReply() {
    scrollHeight = 1600
    act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)))
  }

  it('follows an accepted send in the main conversation while a same-topic tool flow keeps its reading position', async () => {
    render(
      <>
        {primaryConversation}
        <AuxiliaryConversation />
      </>
    )
    const { scroller, handleRef } = startReading()
    const auxiliary = startReading('tool-flow')

    await act(() => EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: 'agent-session:session-b' }))
    expect(scroller.scrollTop).toBe(500)
    expect(handleRef.current?.isFollowing()).toBe(false)

    await act(() => EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: topic.id }))
    expect(scroller.scrollTop).toBe(800)
    expect(handleRef.current?.isFollowing()).toBe(true)
    expect(auxiliary.scroller.scrollTop).toBe(500)
    expect(auxiliary.handleRef.current?.isFollowing()).toBe(false)

    growReply()
    expect(scroller.scrollTop).toBe(1200)
    expect(auxiliary.scroller.scrollTop).toBe(500)
    expect(auxiliary.handleRef.current?.isFollowing()).toBe(false)
  })

  it('preserves the reading position after the visible runtime is unbound', async () => {
    render(primaryConversation)
    const { scroller, handleRef } = startReading()
    viewports.get('main')?.unbind?.()

    await act(() => EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: topic.id }))
    growReply()

    expect(scroller.scrollTop).toBe(500)
    expect(handleRef.current?.isFollowing()).toBe(false)
  })

  it('does not hand an offscreen image-capture runtime control of the conversation', async () => {
    render(<AuxiliaryConversation capture />)
    const { scroller, handleRef } = startReading('capture')

    await act(() => EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: topic.id }))
    growReply()

    expect(scroller.scrollTop).toBe(500)
    expect(handleRef.current?.isFollowing()).toBe(false)
  })
})
