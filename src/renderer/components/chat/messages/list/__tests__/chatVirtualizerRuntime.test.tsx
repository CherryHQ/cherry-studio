import { act, render } from '@testing-library/react'
import { type ReactNode, type Ref } from 'react'
import type { VListHandle } from 'virtua'
import { describe, expect, it, vi } from 'vitest'

import {
  type ChatVirtualizerRuntime,
  type MessageVirtualListHandle,
  useChatVirtualizerRuntime
} from '../chatVirtualizerRuntime'

const getStringItemKey = (item: string) => item

interface RuntimeProbeProps {
  items: string[]
  hasMoreTop?: boolean
  handleRef?: Ref<MessageVirtualListHandle>
  onReachTop?: () => void
  onRuntime(runtime: ChatVirtualizerRuntime<string>): void
  preserveScrollAnchor?: boolean
  scrollToTopKey?: string
}

interface RuntimeDomProbeProps extends RuntimeProbeProps {
  nonce?: number
}

function RuntimeProbe({
  items,
  hasMoreTop = false,
  handleRef,
  onReachTop,
  onRuntime,
  preserveScrollAnchor,
  scrollToTopKey
}: RuntimeProbeProps) {
  const runtime = useChatVirtualizerRuntime({
    items,
    getItemKey: getStringItemKey,
    renderItem: (item): ReactNode => <span>{item}</span>,
    hasMoreTop,
    handleRef,
    onReachTop,
    preserveScrollAnchor,
    scrollToTopKey,
    topReachOverscanItems: 4,
    bottomPadding: 12
  })
  onRuntime(runtime)
  return null
}

function RuntimeDomProbe({
  items,
  handleRef,
  hasMoreTop = false,
  nonce,
  onReachTop,
  onRuntime,
  preserveScrollAnchor,
  scrollToTopKey
}: RuntimeDomProbeProps) {
  void nonce
  const runtime = useChatVirtualizerRuntime({
    items,
    getItemKey: getStringItemKey,
    renderItem: (item): ReactNode => <span>{item}</span>,
    hasMoreTop,
    handleRef,
    onReachTop,
    preserveScrollAnchor,
    scrollToTopKey,
    topReachOverscanItems: 4,
    bottomPadding: 12
  })
  onRuntime(runtime)
  return (
    <div
      ref={(element) => {
        runtime.scrollerRef.current = element
      }}>
      <div ref={runtime.contentRef} />
    </div>
  )
}

function createHandle(overrides?: Partial<VListHandle>): VListHandle {
  return {
    get cache() {
      return [[], 40]
    },
    get scrollOffset() {
      return 0
    },
    get scrollSize() {
      return 1000
    },
    get viewportSize() {
      return 400
    },
    findItemIndex: vi.fn(() => 0),
    getItemOffset: vi.fn(() => 0),
    getItemSize: vi.fn(() => 40),
    scrollBy: vi.fn(),
    scrollTo: vi.fn(),
    scrollToIndex: vi.fn(),
    ...overrides
  } as VListHandle
}

function setElementMetric(element: HTMLElement, name: 'clientHeight' | 'scrollHeight', getValue: () => number): void {
  Object.defineProperty(element, name, {
    configurable: true,
    get: getValue
  })
}

describe('useChatVirtualizerRuntime', () => {
  it('keeps scroll handlers stable across parent rerenders', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    const items = ['message-a']
    const view = render(<RuntimeProbe items={items} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    const scrollerProps = runtime?.scrollerProps
    const onWheel = runtime?.scrollerProps.onWheel
    const onScroll = runtime?.scrollerProps.onScroll

    view.rerender(<RuntimeProbe items={items} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.scrollerProps).toBe(scrollerProps)
    expect(runtime?.scrollerProps.onWheel).toBe(onWheel)
    expect(runtime?.scrollerProps.onScroll).toBe(onScroll)
  })

  it('does not recreate resize observers on unrelated parent rerenders', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const observers: Array<{ disconnect: ReturnType<typeof vi.fn>; observe: ReturnType<typeof vi.fn> }> = []

    class ResizeObserverMock {
      disconnect = vi.fn()
      observe = vi.fn()
      unobserve = vi.fn()

      constructor() {
        observers.push({ disconnect: this.disconnect, observe: this.observe })
      }
    }

    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

    try {
      const items = ['message-a']
      const view = render(<RuntimeDomProbe items={items} nonce={0} onRuntime={() => undefined} />)

      expect(observers).toHaveLength(1)
      expect(observers[0]?.observe).toHaveBeenCalledTimes(2)

      view.rerender(<RuntimeDomProbe items={items} nonce={1} onRuntime={() => undefined} />)

      expect(observers).toHaveLength(1)
      expect(observers[0]?.disconnect).not.toHaveBeenCalled()
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
  })

  it('does not read scroll metrics on unrelated parent rerenders', () => {
    const originalResizeObserver = globalThis.ResizeObserver

    class ResizeObserverMock {
      disconnect = vi.fn()
      observe = vi.fn()
      unobserve = vi.fn()
    }

    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      const items = ['message-a']
      const view = render(
        <RuntimeDomProbe items={items} nonce={0} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />
      )
      const scroller = runtime!.scrollerRef.current!
      let metricReadCount = 0

      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => 0
      })
      setElementMetric(scroller, 'scrollHeight', () => {
        metricReadCount += 1
        return 1101
      })
      setElementMetric(scroller, 'clientHeight', () => {
        metricReadCount += 1
        return 500
      })

      view.rerender(<RuntimeDomProbe items={items} nonce={1} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

      expect(metricReadCount).toBe(0)
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
  })

  it('returns keyed top-level elements so virtua can keep item measurements stable', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    render(<RuntimeProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    const item = runtime?.wrappedItems[0]
    expect(item).toBeDefined()
    expect(runtime?.wrappedRenderItem(item!, 0).key).toBe('message-a')
  })

  it('enables shift only for renders that prepend existing items', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    const initialItems = ['message-a', 'message-b']
    const prependedItems = ['message-old', 'message-a', 'message-b']
    const appendedItems = ['message-old', 'message-a', 'message-b', 'message-new']
    const view = render(<RuntimeProbe items={initialItems} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.shift).toBe(false)

    view.rerender(<RuntimeProbe items={prependedItems} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.shift).toBe(true)

    view.rerender(<RuntimeProbe items={prependedItems} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.shift).toBe(false)

    view.rerender(<RuntimeProbe items={appendedItems} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.shift).toBe(false)
  })

  it('checks reach-top from the scroll path', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    const onReachTop = vi.fn()
    render(
      <RuntimeProbe
        items={['message-a', 'message-b']}
        hasMoreTop
        onReachTop={onReachTop}
        onRuntime={(nextRuntime) => (runtime = nextRuntime)}
      />
    )

    runtime!.vlistHandleRef.current = createHandle({
      findItemIndex: vi.fn(() => 2)
    })
    runtime!.scrollerRef.current = {
      scrollTop: 10,
      scrollHeight: 1000,
      clientHeight: 400
    } as HTMLDivElement

    act(() => {
      runtime!.scrollerProps.onScroll(10)
    })

    expect(onReachTop).toHaveBeenCalledTimes(1)
  })

  it('shows the scroll-to-bottom button only when more than one viewport from bottom', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    render(<RuntimeProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    const scroller = {
      scrollTop: 500,
      scrollHeight: 1500,
      clientHeight: 500
    } as HTMLDivElement
    runtime!.scrollerRef.current = scroller

    act(() => {
      runtime!.scrollerProps.onScroll(500)
    })
    expect(runtime!.isScrollToBottomButtonVisible).toBe(false)

    scroller.scrollTop = 499
    act(() => {
      runtime!.scrollerProps.onScroll(499)
    })
    expect(runtime!.isScrollToBottomButtonVisible).toBe(true)
  })

  it('shows the scroll-to-bottom button when content growth leaves more than one viewport below', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const callbacks: ResizeObserverCallback[] = []

    class ResizeObserverMock {
      disconnect = vi.fn()
      observe = vi.fn()
      unobserve = vi.fn()

      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback)
      }
    }

    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollHeight = 900
      render(<RuntimeDomProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)
      const scroller = runtime!.scrollerRef.current!

      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => 0
      })
      setElementMetric(scroller, 'scrollHeight', () => scrollHeight)
      setElementMetric(scroller, 'clientHeight', () => 500)

      act(() => {
        callbacks[0]?.([], {} as ResizeObserver)
      })
      expect(runtime!.isScrollToBottomButtonVisible).toBe(false)

      scrollHeight = 1101
      act(() => {
        callbacks[0]?.([], {} as ResizeObserver)
      })

      expect(runtime!.isScrollToBottomButtonVisible).toBe(true)
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
  })

  it('hides the scroll-to-bottom button after programmatic scroll to bottom', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    render(<RuntimeProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    let scrollTop = 0
    const scroller = {
      scrollHeight: 1300,
      clientHeight: 500
    } as HTMLDivElement
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value
      }
    })
    runtime!.scrollerRef.current = scroller

    act(() => {
      runtime!.scrollerProps.onScroll(0)
    })
    expect(runtime!.isScrollToBottomButtonVisible).toBe(true)

    act(() => {
      runtime!.scrollToBottom('instant')
    })

    expect(scrollTop).toBe(800)
    expect(runtime!.isScrollToBottomButtonVisible).toBe(false)
  })

  it('hides the scroll-to-bottom button when starting smooth scroll to bottom', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    render(<RuntimeProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    let scrollTop = 0
    const scroller = {
      scrollHeight: 1300,
      clientHeight: 500
    } as HTMLDivElement
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value
      }
    })
    runtime!.scrollerRef.current = scroller

    act(() => {
      runtime!.scrollerProps.onScroll(0)
    })
    expect(runtime!.isScrollToBottomButtonVisible).toBe(true)

    act(() => {
      runtime!.scrollToBottom('smooth')
    })

    expect(runtime!.isScrollToBottomButtonVisible).toBe(false)
  })

  it('resets bottom-follow state when pinning a message to the viewport top', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    let handle: MessageVirtualListHandle | null = null
    const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
      handle = nextHandle
    }
    const view = render(
      <RuntimeProbe items={['message-a']} handleRef={handleRef} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />
    )

    runtime!.vlistHandleRef.current = createHandle({
      getItemOffset: vi.fn(() => 120)
    })
    runtime!.scrollerRef.current = {
      scrollTop: 0,
      scrollHeight: 600,
      clientHeight: 400
    } as HTMLDivElement

    act(() => {
      handle!.scrollToBottom()
    })
    expect(handle!.isAtBottom()).toBe(true)

    view.rerender(
      <RuntimeProbe
        items={['message-a']}
        handleRef={handleRef}
        scrollToTopKey="message-a"
        onRuntime={(nextRuntime) => (runtime = nextRuntime)}
      />
    )

    expect(handle!.isAtBottom()).toBe(false)
  })

  it('does not restore bottom-follow from scroll events while preserving the top anchor', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    let handle: MessageVirtualListHandle | null = null
    const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
      handle = nextHandle
    }
    const view = render(
      <RuntimeProbe items={['message-a']} handleRef={handleRef} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />
    )
    let scrollHeight = 600
    const scroller = {
      scrollTop: 0,
      clientHeight: 400
    } as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight
    })

    runtime!.vlistHandleRef.current = createHandle({
      getItemOffset: vi.fn(() => 120)
    })
    runtime!.scrollerRef.current = scroller

    act(() => {
      handle!.scrollToBottom()
    })
    expect(handle!.isAtBottom()).toBe(true)

    view.rerender(
      <RuntimeProbe
        items={['message-a']}
        handleRef={handleRef}
        preserveScrollAnchor
        scrollToTopKey="message-a"
        onRuntime={(nextRuntime) => (runtime = nextRuntime)}
      />
    )
    expect(handle!.isAtBottom()).toBe(false)

    scroller.scrollTop = 300
    scrollHeight = 700

    act(() => {
      runtime!.scrollerProps.onScroll(300)
    })

    expect(handle!.isAtBottom()).toBe(false)
  })

  it('does not auto-stick to bottom on content growth while preserving the top anchor', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const callbacks: ResizeObserverCallback[] = []

    class ResizeObserverMock {
      disconnect = vi.fn()
      observe = vi.fn()
      unobserve = vi.fn()

      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback)
      }
    }

    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 0
      let scrollHeight = 600
      const view = render(
        <RuntimeDomProbe
          items={['message-a']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      const scroller = runtime!.scrollerRef.current!

      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      Object.defineProperty(scroller, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight
      })
      Object.defineProperty(scroller, 'clientHeight', {
        configurable: true,
        get: () => 400
      })
      runtime!.vlistHandleRef.current = createHandle()

      act(() => {
        handle!.scrollToBottom()
      })
      expect(scrollTop).toBe(200)
      expect(handle!.isAtBottom()).toBe(true)

      view.rerender(
        <RuntimeDomProbe
          items={['message-a']}
          handleRef={handleRef}
          preserveScrollAnchor
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )

      scrollHeight = 900
      act(() => {
        callbacks[0]?.([], {} as ResizeObserver)
      })

      expect(scrollTop).toBe(200)
      expect(handle!.isAtBottom()).toBe(false)
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
  })
})
