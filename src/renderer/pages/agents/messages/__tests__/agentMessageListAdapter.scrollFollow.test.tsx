import { act, cleanup, render } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type ChatVirtualizerRuntime,
  type MessageVirtualListHandle,
  useChatVirtualizerRuntime
} from '@renderer/components/chat/messages/list/chatVirtualizerRuntime'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types/topic'

import { useAgentMessageListProviderValue } from '../agentMessageListAdapter'

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

describe('Agent accepted-send viewport handoff', () => {
  const resizeCallbacks = new Set<ResizeObserverCallback>()
  let handleRef: { current: MessageVirtualListHandle | null }
  let runtime: ChatVirtualizerRuntime<string>
  let unbind: (() => void) | undefined
  let scrollHeight: number

  function Conversation({ capture = false }: { capture?: boolean }) {
    const viewportHandleRef = useRef<MessageVirtualListHandle>(null)
    handleRef = viewportHandleRef
    const provider = useAgentMessageListProviderValue({
      topic,
      messages,
      partsByMessageId,
      isLoading: false,
      messageNavigation: 'anchor',
      imageActionConsumer: capture ? 'capture' : undefined
    })
    const viewport = useChatVirtualizerRuntime({
      items,
      getItemKey,
      renderItem: (item) => item,
      hasMoreTop: false,
      topReachOverscanItems: 4,
      bottomPadding: 0,
      handleRef: viewportHandleRef
    })
    runtime = viewport
    const bindRuntime = provider.actions.bindRuntime
    useEffect(() => {
      const dispose = bindRuntime?.({
        scrollToBottom: viewport.scrollToBottom,
        locateMessage: () => {},
        copyTopicImage: async () => {},
        exportTopicImage: async () => {}
      })
      unbind = dispose ?? undefined
      return dispose
    }, [bindRuntime, viewport.scrollToBottom])

    return (
      <div
        role="region"
        aria-label="Conversation messages"
        ref={(element) => {
          viewport.scrollerRef.current = element
          if (!element) return
          Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight })
          Object.defineProperty(element, 'clientHeight', { configurable: true, value: 400 })
        }}>
        <div ref={viewport.contentRef}>Earlier conversation</div>
        <div ref={viewport.freezeSpacerRef} />
      </div>
    )
  }

  beforeEach(() => {
    scrollHeight = 1200
    unbind = undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: ResizeObserverCallback) {
          resizeCallbacks.add(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {
          resizeCallbacks.delete(this.callback)
        }
      }
    )
  })

  afterEach(() => {
    cleanup()
    resizeCallbacks.clear()
    vi.unstubAllGlobals()
  })

  function startReading() {
    const scroller = runtime.scrollerRef.current!
    scroller.scrollTop = 500
    act(() => runtime.takeUserControl('user-scrolled-up'))
    expect(handleRef.current?.isFollowing()).toBe(false)
    return scroller
  }

  function growReply() {
    scrollHeight = 1600
    act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)))
  }

  it('returns the matching conversation to the live bottom and follows the streamed reply', async () => {
    render(<Conversation />)
    const scroller = startReading()

    await act(() => EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: 'agent-session:session-b' }))
    expect(scroller.scrollTop).toBe(500)
    expect(handleRef.current?.isFollowing()).toBe(false)

    await act(() => EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: topic.id }))
    expect(scroller.scrollTop).toBe(800)
    expect(handleRef.current?.isFollowing()).toBe(true)

    growReply()
    expect(scroller.scrollTop).toBe(1200)
  })

  it('preserves the reading position after the visible runtime is unbound', async () => {
    render(<Conversation />)
    const scroller = startReading()
    unbind?.()

    await act(() => EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: topic.id }))
    growReply()

    expect(scroller.scrollTop).toBe(500)
    expect(handleRef.current?.isFollowing()).toBe(false)
  })

  it('does not hand an offscreen image-capture runtime control of the conversation', async () => {
    render(<Conversation capture />)
    const scroller = startReading()

    await act(() => EventEmitter.emit(EVENT_NAMES.SEND_MESSAGE, { topicId: topic.id }))
    growReply()

    expect(scroller.scrollTop).toBe(500)
    expect(handleRef.current?.isFollowing()).toBe(false)
  })
})
