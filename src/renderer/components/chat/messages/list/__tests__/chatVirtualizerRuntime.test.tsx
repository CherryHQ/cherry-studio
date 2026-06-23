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

function installResizeObserverMock(callbacks: ResizeObserverCallback[]): () => void {
  const originalResizeObserver = globalThis.ResizeObserver

  class ResizeObserverMock {
    disconnect = vi.fn()
    observe = vi.fn()
    unobserve = vi.fn()

    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback)
    }
  }

  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
  return () => {
    globalThis.ResizeObserver = originalResizeObserver
  }
}

function installQueuedAnimationFrame(): { restore(): void; tick(frames?: number): void } {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  let rafId = 0
  let rafQueue = new Map<number, () => void>()

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = ++rafId
    rafQueue.set(id, () => callback(0))
    return id
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) => {
    rafQueue.delete(id)
  }) as typeof cancelAnimationFrame

  return {
    restore() {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    },
    tick(frames = 1) {
      for (let i = 0; i < frames; i++) {
        if (rafQueue.size === 0) return
        const batch = Array.from(rafQueue.values())
        rafQueue = new Map()
        act(() => batch.forEach((fn) => fn()))
      }
    }
  }
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

  it('keeps bottom-follow suppressed while the user is still pinned to the top', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    let handle: MessageVirtualListHandle | null = null
    const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
      handle = nextHandle
    }
    const view = render(
      <RuntimeProbe items={['message-a']} handleRef={handleRef} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />
    )
    // Anchor sits at offset 300, which also happens to be the bottom (700 - 400).
    const scroller = {
      scrollTop: 0,
      scrollHeight: 700,
      clientHeight: 400
    } as HTMLDivElement
    runtime!.vlistHandleRef.current = createHandle({ getItemOffset: vi.fn(() => 300) })
    runtime!.scrollerRef.current = scroller

    view.rerender(
      <RuntimeProbe
        items={['message-a']}
        handleRef={handleRef}
        preserveScrollAnchor
        scrollToTopKey="message-a"
        onRuntime={(nextRuntime) => (runtime = nextRuntime)}
      />
    )

    // A scroll that stays within the release tolerance of the anchor keeps the
    // pin held; even though the position is at the bottom, bottom-follow stays
    // suppressed so it cannot fight the pin.
    scroller.scrollTop = 300
    act(() => {
      runtime!.scrollerProps.onScroll(300)
    })

    expect(handle!.isAtBottom()).toBe(false)
  })

  it('restores bottom-follow once the user scrolls to the bottom after the pin releases', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    let handle: MessageVirtualListHandle | null = null
    const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
      handle = nextHandle
    }
    const view = render(
      <RuntimeProbe items={['message-a']} handleRef={handleRef} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />
    )
    const scroller = {
      scrollTop: 0,
      scrollHeight: 700,
      clientHeight: 400
    } as HTMLDivElement
    runtime!.vlistHandleRef.current = createHandle({ getItemOffset: vi.fn(() => 120) })
    runtime!.scrollerRef.current = scroller

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

    // The user scrolls all the way to the bottom (700 - 400 = 300). That is far
    // enough from the anchor (120) to release the pin, so the user has taken
    // control and reaching the bottom re-engages bottom-follow.
    scroller.scrollTop = 300
    act(() => {
      runtime!.scrollerProps.onScroll(300)
    })

    expect(handle!.isAtBottom()).toBe(true)
  })

  it('auto-sticks to the new bottom after the user scrolls back down mid-stream', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 0
      let scrollHeight = 1000
      render(
        <RuntimeDomProbe
          items={['message-a']}
          handleRef={handleRef}
          preserveScrollAnchor
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
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
      runtime!.vlistHandleRef.current = createHandle()

      // While streaming and untouched, content growth must NOT stick (suppressed).
      scrollHeight = 1200
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(0)

      // The user scrolls to the bottom (1200 - 400 = 800): they take control and
      // bottom-follow re-engages.
      scrollTop = 800
      act(() => runtime!.scrollerProps.onScroll(800))

      // The next large chunk now sticks to the fresh bottom immediately, while
      // the scrollTop change is paced across frames.
      scrollHeight = 2000
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(800)
      expect(handle!.isAtBottom()).toBe(true)
      expect(runtime!.contentRef.current!.style.transform).toBe('')

      raf.tick()
      expect(scrollTop).toBeGreaterThan(800)
      expect(scrollTop).toBeLessThan(900)

      // If another large render lands mid-follow, the in-flight animation
      // keeps chasing the live bottom instead of restarting from scratch.
      scrollHeight = 2200
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(handle!.isAtBottom()).toBe(true)

      raf.tick(100)
      expect(scrollTop).toBe(1800)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('follows visible single-line growth instead of snapping instantly', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 0
      let scrollHeight = 1000
      render(
        <RuntimeDomProbe
          items={['message-a']}
          handleRef={handleRef}
          preserveScrollAnchor
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
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
      runtime!.vlistHandleRef.current = createHandle()

      scrollHeight = 1200
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(0)

      scrollTop = 800
      act(() => runtime!.scrollerProps.onScroll(800))

      scrollHeight = 1220
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(800)
      expect(handle!.isAtBottom()).toBe(true)

      raf.tick()
      expect(scrollTop).toBeGreaterThan(800)
      expect(scrollTop).toBeLessThan(820)

      raf.tick(30)
      expect(scrollTop).toBe(820)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('lets non-wheel upward scrolling take over during bottom-follow', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 0
      let scrollHeight = 1000
      render(
        <RuntimeDomProbe
          items={['message-a']}
          handleRef={handleRef}
          preserveScrollAnchor
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
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
      runtime!.vlistHandleRef.current = createHandle()

      scrollHeight = 1200
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(0)

      scrollTop = 800
      act(() => runtime!.scrollerProps.onScroll(800))
      expect(handle!.isAtBottom()).toBe(true)

      scrollHeight = 2000
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick()
      const followedOffset = scrollTop
      expect(followedOffset).toBeGreaterThan(800)

      act(() => runtime!.scrollerProps.onScroll(followedOffset))

      const userOffset = followedOffset - 40
      scrollTop = userOffset
      act(() => runtime!.scrollerProps.onScroll(userOffset))
      expect(handle!.isAtBottom()).toBe(false)

      scrollHeight = 2200
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(10)

      expect(scrollTop).toBe(userOffset)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('ignores sub-threshold upward jitter during bottom-follow and keeps following', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 0
      let scrollHeight = 1000
      render(
        <RuntimeDomProbe
          items={['message-a']}
          handleRef={handleRef}
          preserveScrollAnchor
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
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
      runtime!.vlistHandleRef.current = createHandle()

      scrollHeight = 1200
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      scrollTop = 800
      act(() => runtime!.scrollerProps.onScroll(800))
      expect(handle!.isAtBottom()).toBe(true)

      scrollHeight = 2000
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick()
      const followedOffset = scrollTop
      expect(followedOffset).toBeGreaterThan(800)

      // Sync the tracker to the follow position the way real frame-by-frame
      // scroll events would (the follow's own writes are forward progress).
      act(() => runtime!.scrollerProps.onScroll(followedOffset))

      // A tiny upward jitter (< takeover threshold) must NOT cancel the follow.
      const jitterOffset = followedOffset - 3
      scrollTop = jitterOffset
      act(() => runtime!.scrollerProps.onScroll(jitterOffset))
      expect(handle!.isAtBottom()).toBe(true)

      // The follow keeps animating all the way to the live bottom (2000 - 400).
      raf.tick(100)
      expect(scrollTop).toBe(1600)
      expect(handle!.isAtBottom()).toBe(true)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('snaps straight to the live bottom when one-shot growth exceeds the crawl threshold', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 0
      let scrollHeight = 1000
      render(
        <RuntimeDomProbe
          items={['message-a']}
          handleRef={handleRef}
          preserveScrollAnchor
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
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
      runtime!.vlistHandleRef.current = createHandle()

      scrollHeight = 1200
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      scrollTop = 800
      act(() => runtime!.scrollerProps.onScroll(800))
      expect(handle!.isAtBottom()).toBe(true)

      // A single render adds > 3 viewports (400px each): distance to bottom is
      // 1300px > 1200px, so the follow snaps in the same frame instead of
      // crawling. A crawl would leave scrollTop at 800 until the first raf tick.
      scrollHeight = 2500
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(2100)
      expect(handle!.isAtBottom()).toBe(true)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps following the real bottom when a released anchor spacer is reclaimed', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 0
      let contentHeight = 900
      const view = render(
        <RuntimeDomProbe
          items={['user-a']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      const getSpacerHeight = () => runtime!.wrappedItems.find((item) => item.kind === 'spacer')?.height ?? 0
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
        get: () => contentHeight + getSpacerHeight()
      })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
      runtime!.vlistHandleRef.current = createHandle({ getItemOffset: vi.fn(() => 300) })

      view.rerender(
        <RuntimeDomProbe
          items={['user-a']}
          handleRef={handleRef}
          preserveScrollAnchor
          scrollToTopKey="user-a"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()
      expect(getSpacerHeight()).toBe(400)

      // The user takes control and reaches the real content bottom. The spacer is
      // artificial scroll range, so it must not be part of bottom-follow.
      scrollTop = 500
      act(() => runtime!.scrollerProps.onScroll(500))
      expect(handle!.isAtBottom()).toBe(true)

      contentHeight = 1300
      act(() => callbacks[callbacks.length - 1]?.([], {} as ResizeObserver))
      expect(handle!.isAtBottom()).toBe(true)

      raf.tick(100)
      expect(getSpacerHeight()).toBe(0)
      expect(scrollTop).toBe(900)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('settles at the real bottom when the preserved anchor releases during bottom-follow', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 0
      let contentHeight = 900
      const view = render(
        <RuntimeDomProbe
          items={['user-a']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      const getSpacerHeight = () => runtime!.wrappedItems.find((item) => item.kind === 'spacer')?.height ?? 0
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
        get: () => contentHeight + getSpacerHeight()
      })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
      runtime!.vlistHandleRef.current = createHandle({ getItemOffset: vi.fn(() => 300) })

      view.rerender(
        <RuntimeDomProbe
          items={['user-a']}
          handleRef={handleRef}
          preserveScrollAnchor
          scrollToTopKey="user-a"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()
      expect(getSpacerHeight()).toBe(400)

      scrollTop = 500
      act(() => runtime!.scrollerProps.onScroll(500))
      expect(handle!.isAtBottom()).toBe(true)

      contentHeight = 1800
      act(() => callbacks[callbacks.length - 1]?.([], {} as ResizeObserver))
      raf.tick()
      expect(scrollTop).toBeGreaterThan(500)
      expect(scrollTop).toBeLessThan(1400)

      view.rerender(
        <RuntimeDomProbe
          items={['user-a']}
          handleRef={handleRef}
          scrollToTopKey="user-a"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()

      expect(scrollTop).toBe(1400)
      expect(handle!.isAtBottom()).toBe(true)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('does not auto-stick to bottom on content growth while preserving the top anchor', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)

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
      restoreResizeObserver()
    }
  })

  it('drops the anchor spacer when the preserve lock releases without a resize', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollHeight = 420
      const view = render(<RuntimeDomProbe items={['user-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)
      const scroller = runtime!.scrollerRef.current!
      Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => 0 })
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => scrollHeight)
      runtime!.vlistHandleRef.current = createHandle({ getItemOffset: vi.fn(() => 300) })

      const hasSpacer = () => runtime!.wrappedItems.some((item) => item.kind === 'spacer')

      // Send: pin the user message to the top while the reply streams (lock held).
      view.rerender(
        <RuntimeDomProbe
          items={['user-a']}
          preserveScrollAnchor
          scrollToTopKey="user-a"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()
      expect(hasSpacer()).toBe(true)

      // Reply grows past one viewport; the spacer is now redundant but stays put
      // because the lock forbids shrinking it mid-stream.
      scrollHeight = 1100
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(hasSpacer()).toBe(true)

      // Streaming ends: the lock releases on its own with NO accompanying resize.
      view.rerender(
        <RuntimeDomProbe
          items={['user-a']}
          scrollToTopKey="user-a"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      // The falling-edge effect re-runs the decay; the now-unneeded spacer drops.
      raf.tick()
      expect(hasSpacer()).toBe(false)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })
})
