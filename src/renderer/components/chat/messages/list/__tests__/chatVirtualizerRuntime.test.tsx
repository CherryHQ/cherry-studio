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
  keepMountedKeys?: readonly string[]
  onReachTop?: () => void
  onRuntime(runtime: ChatVirtualizerRuntime<string>): void
  preserveScrollAnchor?: boolean
  scrollToTopKey?: string
  topPadding?: number
}

interface RuntimeDomProbeProps extends RuntimeProbeProps {
  nonce?: number
}

function RuntimeProbe({
  items,
  hasMoreTop = false,
  handleRef,
  keepMountedKeys,
  onReachTop,
  onRuntime,
  preserveScrollAnchor,
  scrollToTopKey,
  topPadding
}: RuntimeProbeProps) {
  const runtime = useChatVirtualizerRuntime({
    items,
    getItemKey: getStringItemKey,
    renderItem: (item): ReactNode => <span>{item}</span>,
    hasMoreTop,
    handleRef,
    keepMountedKeys,
    onReachTop,
    preserveScrollAnchor,
    scrollToTopKey,
    topPadding,
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
  keepMountedKeys,
  nonce,
  onReachTop,
  onRuntime,
  preserveScrollAnchor,
  scrollToTopKey,
  topPadding
}: RuntimeDomProbeProps) {
  void nonce
  const runtime = useChatVirtualizerRuntime({
    items,
    getItemKey: getStringItemKey,
    renderItem: (item): ReactNode => <span>{item}</span>,
    hasMoreTop,
    handleRef,
    keepMountedKeys,
    onReachTop,
    preserveScrollAnchor,
    scrollToTopKey,
    topPadding,
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
      <div ref={runtime.freezeSpacerRef} />
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
  it('keeps requested live item keys mounted and resolves their index after prepends', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    const view = render(
      <RuntimeProbe
        items={['message-a', 'message-live', 'message-c']}
        keepMountedKeys={['message-live']}
        onRuntime={(nextRuntime) => (runtime = nextRuntime)}
      />
    )

    expect(runtime?.keepMounted).toEqual([1])

    view.rerender(
      <RuntimeProbe
        items={['older', 'message-a', 'message-live', 'message-c']}
        keepMountedKeys={['message-live']}
        onRuntime={(nextRuntime) => (runtime = nextRuntime)}
      />
    )

    expect(runtime?.keepMounted).toEqual([2])
  })

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

  it('scrolls to top instantly and releases the top anchor', () => {
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
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 700 })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
      runtime!.vlistHandleRef.current = createHandle({ getItemOffset: vi.fn(() => 300) })

      view.rerender(
        <RuntimeDomProbe
          items={['message-a']}
          handleRef={handleRef}
          preserveScrollAnchor
          scrollToTopKey="message-a"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()
      expect(runtime!.wrappedItems.some((item) => item.kind === 'spacer')).toBe(true)

      act(() => {
        scrollTop = 300
        handle!.scrollToTop('instant')
      })
      expect(scrollTop).toBe(0)

      act(() => callbacks[0]?.([], {} as ResizeObserver))

      expect(scrollTop).toBe(0)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('scrolls to top smoothly with the RAF-driven runtime scroller', () => {
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 500
      render(
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

      act(() => {
        handle!.scrollToTop('smooth')
      })
      expect(scrollTop).toBe(500)

      raf.tick()
      expect(scrollTop).toBeGreaterThan(0)
      expect(scrollTop).toBeLessThan(500)

      raf.tick(50)
      expect(scrollTop).toBe(0)
    } finally {
      raf.restore()
    }
  })

  it.each([
    ['top', (handle: MessageVirtualListHandle) => handle.scrollToTop('instant')],
    ['a message key', (handle: MessageVirtualListHandle) => handle.scrollToKey('message-a', 'start')]
  ])('keeps reading at %s when streaming content grows after explicit navigation', (_label, navigate) => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 1200
      let scrollHeight = 1600
      render(
        <RuntimeDomProbe
          items={['message-a', 'message-b']}
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
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => scrollHeight)
      runtime!.vlistHandleRef.current = createHandle({
        findItemIndex: vi.fn((offset) => (offset >= 800 ? 1 : 0)),
        getItemOffset: vi.fn((index) => index * 800),
        getItemSize: vi.fn(() => 400),
        scrollToIndex: vi.fn(() => {
          scrollTop = 0
        })
      })

      act(() => runtime!.scrollToBottom('instant'))
      expect(scrollTop).toBe(1200)

      act(() => navigate(handle!))
      raf.tick(60)
      expect(scrollTop).toBe(0)

      scrollHeight = 1700
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
      raf.tick(60)

      expect(scrollTop).toBe(0)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps the requested heading anchored when content before it grows inside a block wrapper', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 1200
      let scrollHeight = 1600
      render(
        <RuntimeDomProbe
          items={['message-a', 'message-b']}
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
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => scrollHeight)
      Object.defineProperty(scroller, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: 0, bottom: 400, left: 0, right: 800, width: 800, height: 400, x: 0, y: 0 })
      })
      runtime!.vlistHandleRef.current = createHandle({
        findItemIndex: vi.fn((offset) => (offset >= 800 ? 1 : 0)),
        getItemOffset: vi.fn((index) => index * 800)
      })

      const message = document.createElement('div')
      message.dataset.messageKey = 'message-a'
      const blockWrapper = document.createElement('div')
      blockWrapper.className = 'block-wrapper'
      const heading = document.createElement('h2')
      let headingDocumentTop = 300
      Object.defineProperty(heading, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          top: headingDocumentTop - scrollTop,
          bottom: headingDocumentTop + 40 - scrollTop,
          left: 0,
          right: 800,
          width: 800,
          height: 40,
          x: 0,
          y: headingDocumentTop - scrollTop
        })
      })
      blockWrapper.append(heading)
      message.append(blockWrapper)
      runtime!.contentRef.current!.prepend(message)

      act(() => runtime!.scrollToBottom('instant'))
      act(() => handle!.scrollToElement(heading))
      raf.tick(60)
      expect(scrollTop).toBe(300)

      headingDocumentTop = 350
      scrollHeight = 1700
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
      raf.tick(60)

      expect(scrollTop).toBe(350)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps key navigation aimed at the same message when history is prepended mid-animation', () => {
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 0
      const view = render(
        <RuntimeDomProbe
          items={['message-a', 'message-b', 'message-target']}
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
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => 2000)
      runtime!.vlistHandleRef.current = createHandle({
        getItemOffset: vi.fn((index) => index * 400),
        getItemSize: vi.fn(() => 400)
      })

      act(() => handle!.scrollToKey('message-target', 'start'))
      raf.tick()
      expect(scrollTop).toBeGreaterThan(0)
      expect(scrollTop).toBeLessThan(800)

      view.rerender(
        <RuntimeDomProbe
          items={['message-older', 'message-a', 'message-b', 'message-target']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick(60)

      expect(scrollTop).toBe(1200)
    } finally {
      raf.restore()
    }
  })

  it('replaces an in-flight smooth scroll when scrolling to top', () => {
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 0
      render(
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
      setElementMetric(scroller, 'scrollHeight', () => 1200)
      setElementMetric(scroller, 'clientHeight', () => 400)

      act(() => {
        handle!.scrollToBottom('smooth')
      })
      raf.tick()
      const bottomScrollProgress = scrollTop
      expect(bottomScrollProgress).toBeGreaterThan(0)

      act(() => {
        handle!.scrollToTop('smooth')
      })
      raf.tick()
      expect(scrollTop).toBeLessThan(bottomScrollProgress)

      raf.tick(50)
      expect(scrollTop).toBe(0)
    } finally {
      raf.restore()
    }
  })

  it('replaces an in-flight smooth scroll when scrolling to bottom', () => {
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 800
      render(
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
      setElementMetric(scroller, 'scrollHeight', () => 1200)
      setElementMetric(scroller, 'clientHeight', () => 400)

      act(() => {
        handle!.scrollToTop('smooth')
      })
      raf.tick()
      const topScrollProgress = scrollTop
      expect(topScrollProgress).toBeLessThan(800)

      act(() => {
        handle!.scrollToBottom('smooth')
      })
      raf.tick()
      expect(scrollTop).toBeGreaterThan(topScrollProgress)

      raf.tick(50)
      expect(scrollTop).toBe(800)
    } finally {
      raf.restore()
    }
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

  it('does not pin a follow-up steered into a still-streaming turn', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      // Render 1: a turn is already streaming (preserveScrollAnchor is true) and no
      // new user-message key has arrived yet.
      const view = render(
        <RuntimeDomProbe items={['user-a']} preserveScrollAnchor onRuntime={(nextRuntime) => (runtime = nextRuntime)} />
      )
      const getSpacerHeight = () => runtime!.wrappedItems.find((item) => item.kind === 'spacer')?.height ?? 0
      const scroller = runtime!.scrollerRef.current!
      Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => 0 })
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 900 + getSpacerHeight() })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
      runtime!.vlistHandleRef.current = createHandle({ getItemOffset: vi.fn(() => 300) })

      // Render 2: a queued follow-up is steered into the live turn — a new user
      // message (`user-b`) arrives while streaming continues. Because a turn was
      // already streaming just before it, the message must NOT pin to the top, so
      // no anchor spacer is created (the pin path is what created the instability).
      view.rerender(
        <RuntimeDomProbe
          items={['user-a', 'user-b']}
          preserveScrollAnchor
          scrollToTopKey="user-b"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()

      expect(getSpacerHeight()).toBe(0)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
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
    // control and reaching the bottom re-engages bottom-follow. The scroll is a
    // real user gesture (input-gated), so flag the input first.
    scroller.scrollTop = 300
    act(() => {
      runtime!.markUserInput()
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

      // A real non-wheel upward gesture (scrollbar drag) fires pointerdown, which
      // the host reports via markUserInput; that's what makes this a takeover
      // rather than a programmatic remeasure jump (which must NOT take over).
      const userOffset = followedOffset - 40
      scrollTop = userOffset
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(userOffset)
      })
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

  it('stops following and freezes the viewport when the user takes control during bottom-follow', () => {
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

      // At the live bottom during streaming — auto-stick follows growth.
      scrollTop = 800
      act(() => runtime!.scrollerProps.onScroll(800))
      expect(handle!.isAtBottom()).toBe(true)

      // Any direct interaction (a click, a key, a toggle — the host wires them
      // all to takeUserControl) hands the user the wheel: the at-bottom latch
      // drops and the viewport freezes where it stands.
      act(() => runtime!.takeUserControl())
      expect(handle!.isAtBottom()).toBe(false)

      // Streaming keeps growing — the frozen viewport must not follow.
      scrollHeight = 2000
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(10)
      expect(scrollTop).toBe(800)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('recovers bottom-follow after a local disclosure collapses back at the real bottom', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 800
      let scrollHeight = 1200
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
      raf.tick(60)

      act(() => runtime!.scrollerProps.onScroll(800))
      expect(handle!.isAtBottom()).toBe(true)
      act(() => runtime!.takeUserControl())
      expect(handle!.isAtBottom()).toBe(false)

      act(() => runtime!.releaseUserControlIfAtBottomAfterLayout())
      raf.tick(2)
      expect(handle!.isAtBottom()).toBe(true)

      scrollHeight = 1400
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(20)
      expect(scrollTop).toBe(1000)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('recovers bottom-follow after disclosure shrink creates temporary freeze slack', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 800
      let naturalScrollHeight = 1200
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
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => {
        const slack = Number.parseFloat(runtime!.freezeSpacerRef.current?.style.height || '0')
        return naturalScrollHeight + slack
      })
      runtime!.vlistHandleRef.current = createHandle()
      raf.tick(60)

      act(() => runtime!.scrollerProps.onScroll(800))
      act(() => runtime!.takeUserControl())
      act(() => runtime!.releaseUserControlIfAtBottomAfterLayout())

      naturalScrollHeight = 700
      scrollTop = 300
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(runtime!.freezeSpacerRef.current).toHaveStyle({ height: '500px' })
      expect(scrollTop).toBe(800)

      raf.tick(2)

      expect(runtime!.freezeSpacerRef.current).toHaveStyle({ height: '0px' })
      expect(scrollTop).toBe(300)
      expect(handle!.isAtBottom()).toBe(true)

      naturalScrollHeight = 900
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(20)
      expect(scrollTop).toBe(500)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('does not recover bottom-follow when disclosure shrink passes a reading viewport', () => {
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
      let naturalScrollHeight = 1200
      render(
        <RuntimeDomProbe
          items={['current-user-message', 'assistant-message']}
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
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => {
        const slack = Number.parseFloat(runtime!.freezeSpacerRef.current?.style.height || '0')
        return naturalScrollHeight + slack
      })
      runtime!.vlistHandleRef.current = createHandle({
        findItemIndex: vi.fn(() => 1),
        getItemOffset: vi.fn((index) => (index === 1 ? 500 : 0))
      })
      raf.tick(60)

      // The user has moved the sent message above the viewport but is still
      // reading 200px above the real bottom when they collapse the process run.
      scrollTop = 600
      act(() => runtime!.takeUserControl())
      act(() => runtime!.releaseUserControlIfAtBottomAfterLayout())

      // The collapse moves the new real bottom above the preserved reading
      // position. Freeze slack restores that position after the browser clamp.
      naturalScrollHeight = 700
      scrollTop = 300
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(runtime!.freezeSpacerRef.current).toHaveStyle({ height: '500px' })
      expect(scrollTop).toBe(600)

      // Recovery must use the pre-collapse bottom snapshot. Treating the
      // negative post-collapse distance as "at bottom" clears the slack and
      // exposes the messages above for one visible jump.
      raf.tick(2)
      expect(runtime!.freezeSpacerRef.current).toHaveStyle({ height: '500px' })
      expect(scrollTop).toBe(600)
      expect(handle!.isAtBottom()).toBe(false)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('restores a frozen reading viewport when shrink clamps scroll before resize observation', () => {
    const raf = installQueuedAnimationFrame()
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1_000_000)

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 600
      let naturalScrollHeight = 1200
      render(
        <RuntimeDomProbe
          items={['current-user-message', 'assistant-message']}
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
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => {
        const slack = Number.parseFloat(runtime!.freezeSpacerRef.current?.style.height || '0')
        return naturalScrollHeight + slack
      })
      runtime!.vlistHandleRef.current = createHandle({
        findItemIndex: vi.fn(() => 1),
        getItemOffset: vi.fn((index) => (index === 1 ? 500 : 0))
      })
      raf.tick(60)

      scrollTop = 600
      act(() => runtime!.takeUserControl())

      // The disclosure shrinks and the browser clamps immediately. This scroll
      // can arrive before the runtime observer, or after virtua's own observer.
      naturalScrollHeight = 700
      scrollTop = 300
      act(() => runtime!.scrollerProps.onScroll(300))

      expect(runtime!.freezeSpacerRef.current).toHaveStyle({ height: '500px' })
      expect(scrollTop).toBe(600)
    } finally {
      nowSpy.mockRestore()
      raf.restore()
    }
  })

  it('does not reclaim a protected anchor spacer during local follow recovery', () => {
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 0
      const naturalContentHeight = 1300
      const view = render(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      const getAnchorSpacerHeight = () => runtime!.wrappedItems.find((item) => item.kind === 'spacer')?.height ?? 0
      const getFreezeSpacerHeight = () => Number.parseFloat(runtime!.freezeSpacerRef.current?.style.height || '0')
      const scroller = runtime!.scrollerRef.current!
      const content = runtime!.contentRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(
        scroller,
        'scrollHeight',
        () => naturalContentHeight + getAnchorSpacerHeight() + getFreezeSpacerHeight()
      )
      setElementMetric(content, 'scrollHeight', () => naturalContentHeight + getAnchorSpacerHeight())
      runtime!.vlistHandleRef.current = createHandle({
        findItemIndex: vi.fn(() => 0),
        getItemOffset: vi.fn((index) => (index === 1 ? 1000 : 0))
      })
      raf.tick(60)

      view.rerender(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          handleRef={handleRef}
          preserveScrollAnchor
          scrollToTopKey="current-user-message"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()
      expect(getAnchorSpacerHeight()).toBe(400)

      scrollTop = 1000
      act(() => runtime!.takeUserControl())
      act(() => runtime!.releaseUserControlIfAtBottomAfterLayout())
      raf.tick(2)

      expect(getAnchorSpacerHeight()).toBe(400)
      expect(scrollTop).toBe(1000)
      expect(handle!.isAtBottom()).toBe(false)
    } finally {
      raf.restore()
    }
  })

  it('re-asserts the frozen viewport when a programmatic nudge drifts it', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()
    // Deterministically outside the user-input window (the freeze only yields to
    // the user's own in-flight scrolling), regardless of how young the jsdom
    // time origin is when this test runs.
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1_000_000)

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 500
      render(<RuntimeDomProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)
      const scroller = runtime!.scrollerRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 2000 })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
      runtime!.vlistHandleRef.current = createHandle()
      raf.tick(60)

      // The user takes control while reading mid-list; the freeze anchors here.
      act(() => runtime!.takeUserControl())

      // A rogue programmatic scroll (a child `scrollIntoView`, a remeasure that
      // virtua did not compensate) drifts the frozen viewport; the next observed
      // layout pass must snap it back.
      scrollTop = 560
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(500)
    } finally {
      nowSpy.mockRestore()
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('passes the scroller-relative offset to virtua when capturing with a start margin', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    let scrollTop = 144
    const findItemIndex = vi.fn(() => 1)
    render(
      <RuntimeDomProbe
        items={['message-a', 'message-b']}
        topPadding={44}
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
    setElementMetric(scroller, 'clientHeight', () => 400)
    setElementMetric(scroller, 'scrollHeight', () => 1200)
    runtime!.vlistHandleRef.current = createHandle({
      findItemIndex,
      getItemOffset: vi.fn((index) => index * 100)
    })

    act(() => runtime!.takeUserControl())

    expect(findItemIndex).toHaveBeenCalledWith(144)
  })

  it('resolves a frozen item by stable key after older items are prepended', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1_000_000)

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 150
      let itemOffsets = [0, 100]
      const view = render(
        <RuntimeDomProbe items={['message-a', 'message-b']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />
      )
      const scroller = runtime!.scrollerRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => 1600)
      runtime!.vlistHandleRef.current = createHandle({
        findItemIndex: vi.fn((offset) => Math.floor(offset / 100)),
        getItemOffset: vi.fn((index) => itemOffsets[index] ?? 0)
      })

      act(() => runtime!.takeUserControl())

      itemOffsets = [0, 100, 200, 300]
      view.rerender(
        <RuntimeDomProbe
          items={['message-old-a', 'message-old-b', 'message-a', 'message-b']}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      scrollTop = 120
      act(() => callbacks[callbacks.length - 1]?.([], {} as ResizeObserver))

      expect(scrollTop).toBe(350)
    } finally {
      nowSpy.mockRestore()
      restoreResizeObserver()
    }
  })

  it('keeps updating the freeze anchor throughout a long user scroll gesture', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    let now = 1_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now)

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 500
      render(<RuntimeDomProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)
      const scroller = runtime!.scrollerRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => 2000)
      runtime!.vlistHandleRef.current = createHandle()

      act(() => runtime!.takeUserControl())
      now = 1_010
      act(() => {
        runtime!.markUserInput()
        scrollTop = 450
        runtime!.scrollerProps.onScroll(450)
      })

      // Trackpad momentum / scrollbar dragging can continue well beyond the
      // initial input window without another wheel or pointerdown.
      now = 2_000
      act(() => {
        scrollTop = 400
        runtime!.scrollerProps.onScroll(400)
        runtime!.scrollerProps.onScrollEnd()
      })

      scrollTop = 460
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(400)
    } finally {
      nowSpy.mockRestore()
      restoreResizeObserver()
    }
  })

  it('uses the interacted DOM element to survive reflow inside one virtual item', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 500
      let anchorTop = 120
      render(<RuntimeDomProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)
      const scroller = runtime!.scrollerRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      Object.defineProperty(scroller, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: 0, bottom: 400, left: 0, right: 800, width: 800, height: 400, x: 0, y: 0 })
      })
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => 2000)
      runtime!.vlistHandleRef.current = createHandle()

      const item = document.createElement('div')
      item.dataset.messageKey = 'message-a'
      const toggle = document.createElement('button')
      Object.defineProperty(toggle, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          top: anchorTop,
          bottom: anchorTop + 32,
          left: 0,
          right: 200,
          width: 200,
          height: 32,
          x: 0,
          y: anchorTop
        })
      })
      item.append(toggle)
      runtime!.contentRef.current!.prepend(item)

      act(() => runtime!.takeUserControl(toggle))

      // Content above the toggle reflows inside the same MessageGroup. The
      // virtual item's start offset is unchanged, but the interacted element moved.
      anchorTop = 170
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(550)
    } finally {
      restoreResizeObserver()
    }
  })

  it('adds temporary bottom slack so a frozen viewport survives content shrink', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 800
      let naturalScrollHeight = 1200
      render(<RuntimeDomProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)
      const scroller = runtime!.scrollerRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => {
        const slack = Number.parseFloat(runtime!.freezeSpacerRef.current?.style.height || '0')
        return naturalScrollHeight + slack
      })
      runtime!.vlistHandleRef.current = createHandle()

      act(() => runtime!.takeUserControl())

      naturalScrollHeight = 700
      scrollTop = 300 // browser clamp after the collapse
      act(() => callbacks[0]?.([], {} as ResizeObserver))

      expect(runtime!.freezeSpacerRef.current).toHaveStyle({ height: '500px' })
      expect(scrollTop).toBe(800)
    } finally {
      restoreResizeObserver()
    }
  })

  it('bridges pinned spacer growth before its React commit when a disclosure collapses', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 0
      let naturalContentHeight = 1000
      const view = render(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      const getAnchorSpacerHeight = () => runtime!.wrappedItems.find((item) => item.kind === 'spacer')?.height ?? 0
      const getFreezeSpacerHeight = () => Number.parseFloat(runtime!.freezeSpacerRef.current?.style.height || '0')
      const scroller = runtime!.scrollerRef.current!
      const content = runtime!.contentRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = Math.min(value, Math.max(0, scroller.scrollHeight - scroller.clientHeight))
        }
      })
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => {
        return naturalContentHeight + getAnchorSpacerHeight() + getFreezeSpacerHeight()
      })
      setElementMetric(content, 'scrollHeight', () => {
        return naturalContentHeight + getAnchorSpacerHeight()
      })
      runtime!.vlistHandleRef.current = createHandle({
        findItemIndex: vi.fn(() => 0),
        getItemOffset: vi.fn((index) => (index === 1 ? 1000 : 0))
      })
      raf.tick(60)

      view.rerender(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          preserveScrollAnchor
          scrollToTopKey="current-user-message"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()
      expect(getAnchorSpacerHeight()).toBe(400)

      scrollTop = 1000
      act(() => runtime!.scrollerProps.onScroll(1000))
      act(() => runtime!.takeUserControl())

      // Collapsing the disclosure removes range before the larger anchor spacer
      // can commit. The temporary freeze spacer must bridge that one-frame gap.
      naturalContentHeight = 820
      scrollTop = Math.min(scrollTop, scroller.scrollHeight - scroller.clientHeight)
      expect(scrollTop).toBe(820)

      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))

      expect(getAnchorSpacerHeight()).toBe(580)
      expect(getFreezeSpacerHeight()).toBe(180)
      expect(scrollTop).toBe(1000)

      // Once the anchor spacer is present in the measured DOM, the temporary
      // bridge is redundant and should be reclaimed without moving the viewport.
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
      expect(getFreezeSpacerHeight()).toBe(0)
      expect(scrollTop).toBe(1000)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it.each([
    ['continues after the spacer is consumed', true],
    ['ends as the spacer is consumed', false]
  ])('bounds the released anchor range when streaming %s', (_label, streamContinues) => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 0
      const scrollWrites: number[] = []
      let naturalContentHeight = 1300
      const view = render(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      const getAnchorSpacerHeight = () => runtime!.wrappedItems.find((item) => item.kind === 'spacer')?.height ?? 0
      const getFreezeSpacerHeight = () => Number.parseFloat(runtime!.freezeSpacerRef.current?.style.height || '0')
      const scroller = runtime!.scrollerRef.current!
      const content = runtime!.contentRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollWrites.push(value)
          scrollTop = value
        }
      })
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => {
        return naturalContentHeight + getAnchorSpacerHeight() + getFreezeSpacerHeight()
      })
      setElementMetric(content, 'scrollHeight', () => {
        return naturalContentHeight + getAnchorSpacerHeight()
      })
      runtime!.vlistHandleRef.current = createHandle({
        findItemIndex: vi.fn(() => 0),
        getItemOffset: vi.fn((index) => (index === 1 ? 1000 : 0))
      })
      raf.tick(60)

      view.rerender(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          preserveScrollAnchor
          scrollToTopKey="current-user-message"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()
      expect(getAnchorSpacerHeight()).toBe(400)

      // The runtime first settles the fresh user message at its history-relative
      // offset, then the user scrolls upward and takes ownership of the viewport.
      scrollTop = 1000
      act(() => runtime!.scrollerProps.onScroll(1000))
      scrollTop = 800
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(800)
      })

      // Expanding a thinking block consumes the released pin's bottom room
      // temporarily; collapsing it restores the same fixed total-size budget.
      naturalContentHeight = 1600
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))

      expect(getAnchorSpacerHeight()).toBe(100)
      expect(getFreezeSpacerHeight()).toBe(0)
      expect(scrollTop).toBe(800)

      naturalContentHeight = 1300
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))

      expect(getAnchorSpacerHeight()).toBe(400)
      expect(getFreezeSpacerHeight()).toBe(300)
      expect(scrollTop).toBe(800)

      // The committed anchor spacer now provides the restored range, so the
      // next measurement can reclaim the one-frame bridge.
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
      expect(getFreezeSpacerHeight()).toBe(0)
      expect(scrollTop).toBe(800)

      // Returning to the effective bottom while the reply is still only using
      // the preparation spacer records the user's intent to resume following,
      // but keeps one writer: the frozen viewport. Handing directly to
      // auto-follow here makes spacer decay and scrollTop chase each other.
      scrollTop = 900
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(900)
      })
      expect(getAnchorSpacerHeight()).toBe(400)
      expect(scrollTop).toBe(900)
      scrollWrites.length = 0

      naturalContentHeight = 1600
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
      raf.tick(60)
      expect(getAnchorSpacerHeight()).toBe(100)
      expect(scrollTop).toBe(900)
      expect(scrollWrites).toEqual([])

      // Consuming the final preparation spacer must not collapse the remaining
      // visual room with an instant scrollTop jump. Keep the viewport still for
      // this frame; the next real token growth resumes normal smooth following.
      naturalContentHeight = 1700
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
      raf.tick(60)
      expect(getAnchorSpacerHeight()).toBe(0)
      expect(scrollTop).toBe(900)
      expect(scrollWrites).toEqual([])

      if (!streamContinues) {
        view.rerender(
          <RuntimeDomProbe
            items={['history-message', 'current-user-message']}
            scrollToTopKey="current-user-message"
            onRuntime={(nextRuntime) => (runtime = nextRuntime)}
          />
        )
        raf.tick(60)
        expect(scrollTop).toBe(900)

        // A late non-streaming layout change must not revive the deferred
        // follow and perform the jump after the response has already ended.
        naturalContentHeight = 1800
        act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
        raf.tick(60)
        expect(scrollTop).toBe(900)
        expect(scrollWrites).toEqual([])
        return
      }

      naturalContentHeight = 1800
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(900)
      raf.tick()
      expect(scrollTop).toBeGreaterThan(900)
      expect(scrollTop).toBeLessThan(1400)
      raf.tick(60)
      expect(scrollTop).toBe(1400)

      // With no temporary range left, bottom-follow may resume and later
      // content shrink must not resurrect the released spacer budget.
      naturalContentHeight = 1600
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
      expect(getAnchorSpacerHeight()).toBe(0)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps the pinned preparation spacer when the user takes over before the bootstrap spacer tightens', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 0
      let naturalContentHeight = 1300
      const view = render(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      const getAnchorSpacerHeight = () => runtime!.wrappedItems.find((item) => item.kind === 'spacer')?.height ?? 0
      const getFreezeSpacerHeight = () => Number.parseFloat(runtime!.freezeSpacerRef.current?.style.height || '0')
      const scroller = runtime!.scrollerRef.current!
      const content = runtime!.contentRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => {
        return naturalContentHeight + getAnchorSpacerHeight() + getFreezeSpacerHeight()
      })
      setElementMetric(content, 'scrollHeight', () => {
        return naturalContentHeight + getAnchorSpacerHeight()
      })
      runtime!.vlistHandleRef.current = createHandle({
        findItemIndex: vi.fn(() => 0),
        getItemOffset: vi.fn((index) => (index === 1 ? 1000 : 0))
      })
      raf.tick(60)

      view.rerender(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          preserveScrollAnchor
          scrollToTopKey="current-user-message"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()
      expect(getAnchorSpacerHeight()).toBe(400)

      scrollTop = 1000
      act(() => runtime!.scrollerProps.onScroll(1000))
      // A tiny upward wheel: takes over reading control but stays within the
      // pin's release tolerance, so the pin keeps holding under a user driver.
      scrollTop = 990
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(990)
      })
      expect(getAnchorSpacerHeight()).toBe(400)

      // Measurement settle: the bootstrap spacer tightens (400 -> 100) and the
      // freeze compensates the range with its own slack.
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
      expect(getAnchorSpacerHeight()).toBe(100)

      // Next streaming growth: the freeze slack must not inflate the anchor's
      // natural-size math — that made `needed` hit 0 and instantly wiped the
      // preparation spacer (and the pin) mid-stream.
      naturalContentHeight = 1350
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
      expect(getAnchorSpacerHeight()).toBe(100)
      expect(scrollTop).toBe(1000)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it.each([
    ['was already at the real bottom when streaming ended', true],
    ['returned to the real bottom after streaming ended', false]
  ])('reclaims a released anchor spacer when the user %s', (_label, reachBottomBeforeEnd) => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 0
      const naturalContentHeight = 1300
      const view = render(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      const getAnchorSpacerHeight = () => runtime!.wrappedItems.find((item) => item.kind === 'spacer')?.height ?? 0
      const getFreezeSpacerHeight = () => Number.parseFloat(runtime!.freezeSpacerRef.current?.style.height || '0')
      const scroller = runtime!.scrollerRef.current!
      const content = runtime!.contentRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => {
        return naturalContentHeight + getAnchorSpacerHeight() + getFreezeSpacerHeight()
      })
      setElementMetric(content, 'scrollHeight', () => {
        return naturalContentHeight + getAnchorSpacerHeight()
      })
      runtime!.vlistHandleRef.current = createHandle({
        findItemIndex: vi.fn(() => 0),
        getItemOffset: vi.fn((index) => (index === 1 ? 1000 : 0))
      })
      raf.tick(60)

      view.rerender(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          preserveScrollAnchor
          scrollToTopKey="current-user-message"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()
      expect(getAnchorSpacerHeight()).toBe(400)

      scrollTop = 1000
      act(() => runtime!.scrollerProps.onScroll(1000))
      scrollTop = 800
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(800)
      })

      if (reachBottomBeforeEnd) {
        scrollTop = 900
        act(() => {
          runtime!.markUserInput()
          runtime!.scrollerProps.onScroll(900)
        })
        expect(getAnchorSpacerHeight()).toBe(400)
      }

      view.rerender(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          scrollToTopKey="current-user-message"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()

      if (!reachBottomBeforeEnd) {
        expect(getAnchorSpacerHeight()).toBe(400)
        scrollTop = 900
        act(() => {
          runtime!.markUserInput()
          runtime!.scrollerProps.onScroll(900)
        })
      }

      expect(getAnchorSpacerHeight()).toBe(0)
      expect(getFreezeSpacerHeight()).toBe(0)
      expect(scrollTop).toBe(900)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('still reclaims the spacer at stream end when a re-render lands before the reclaim frame', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 0
      const naturalContentHeight = 1300
      const view = render(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      const getAnchorSpacerHeight = () => runtime!.wrappedItems.find((item) => item.kind === 'spacer')?.height ?? 0
      const getFreezeSpacerHeight = () => Number.parseFloat(runtime!.freezeSpacerRef.current?.style.height || '0')
      const scroller = runtime!.scrollerRef.current!
      const content = runtime!.contentRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => {
        return naturalContentHeight + getAnchorSpacerHeight() + getFreezeSpacerHeight()
      })
      setElementMetric(content, 'scrollHeight', () => {
        return naturalContentHeight + getAnchorSpacerHeight()
      })
      runtime!.vlistHandleRef.current = createHandle({
        findItemIndex: vi.fn(() => 0),
        getItemOffset: vi.fn((index) => (index === 1 ? 1000 : 0))
      })
      raf.tick(60)

      view.rerender(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          preserveScrollAnchor
          scrollToTopKey="current-user-message"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()
      expect(getAnchorSpacerHeight()).toBe(400)

      scrollTop = 1000
      act(() => runtime!.scrollerProps.onScroll(1000))
      scrollTop = 800
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(800)
      })
      scrollTop = 900
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(900)
      })
      expect(getAnchorSpacerHeight()).toBe(400)

      view.rerender(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          scrollToTopKey="current-user-message"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      // A commit between the falling edge and its reclaim frame changes the
      // identities of the freeze callbacks (any anchor-spacer state change does
      // this in production). It must not cancel the scheduled reclaim.
      view.rerender(
        <RuntimeDomProbe
          items={['history-message', 'current-user-message']}
          scrollToTopKey="current-user-message"
          topPadding={2}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()

      expect(getAnchorSpacerHeight()).toBe(0)
      expect(getFreezeSpacerHeight()).toBe(0)
      expect(scrollTop).toBe(900)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps user ownership after streaming ends so late layout stays anchored', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 500
      const view = render(
        <RuntimeDomProbe
          items={['message-a']}
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
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => 2000)
      runtime!.vlistHandleRef.current = createHandle()
      raf.tick(60)

      act(() => runtime!.takeUserControl())
      view.rerender(<RuntimeDomProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)
      raf.tick()

      scrollTop = 560
      act(() => callbacks[callbacks.length - 1]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(500)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('cancels an in-flight smooth scroll when the user takes control', () => {
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      render(
        <RuntimeDomProbe
          items={['message-a', 'message-b']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      const scroller = runtime!.scrollerRef.current!
      let scrollTop = 800
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 2000 })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
      runtime!.vlistHandleRef.current = createHandle()
      raf.tick(60)
      scrollTop = 800

      // A smooth scroll-to-top is in flight...
      act(() => handle!.scrollToTop('smooth'))
      raf.tick()
      const midFlight = scrollTop
      expect(midFlight).toBeLessThan(800)
      expect(midFlight).toBeGreaterThan(0)

      // ...and a direct interaction takes the wheel: the animation dies where it
      // is instead of dragging the user away from what they just touched.
      act(() => runtime!.takeUserControl())
      raf.tick(10)
      expect(scrollTop).toBe(midFlight)
    } finally {
      raf.restore()
    }
  })

  it.each([-40, 40])('cancels read navigation on wheel input with deltaY %s', (deltaY) => {
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 800
      render(
        <RuntimeDomProbe
          items={['message-a', 'message-b']}
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
      setElementMetric(scroller, 'scrollHeight', () => 2000)
      setElementMetric(scroller, 'clientHeight', () => 400)
      runtime!.vlistHandleRef.current = createHandle()

      act(() => handle!.scrollToTop('smooth'))
      raf.tick()
      const midFlight = scrollTop

      act(() => runtime!.scrollerProps.onWheel(new WheelEvent('wheel', { deltaY })))
      raf.tick(10)

      expect(scrollTop).toBe(midFlight)
    } finally {
      raf.restore()
    }
  })

  it('keeps following the real bottom when the viewport becomes shorter', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 800
      let clientHeight = 400
      render(<RuntimeDomProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)
      const scroller = runtime!.scrollerRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      setElementMetric(scroller, 'scrollHeight', () => 1200)
      setElementMetric(scroller, 'clientHeight', () => clientHeight)
      runtime!.vlistHandleRef.current = createHandle()

      act(() => runtime!.scrollToBottom('instant'))
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
      raf.tick(60)

      clientHeight = 300
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver))
      raf.tick(60)

      expect(scrollTop).toBe(900)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('hands the wheel back when the user returns to the bottom after a takeover', () => {
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

      // At the live bottom during streaming — following.
      scrollTop = 800
      act(() => runtime!.scrollerProps.onScroll(800))
      expect(handle!.isAtBottom()).toBe(true)

      // A direct interaction freezes the viewport mid-stream.
      act(() => runtime!.takeUserControl())
      scrollHeight = 1600
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(10)
      expect(scrollTop).toBe(800)

      // The user scrolls down to the new live bottom: that hands the wheel back,
      // so the next growth follows again.
      scrollTop = 1200
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(1200)
      })
      expect(handle!.isAtBottom()).toBe(true)

      scrollHeight = 1800
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(100)
      expect(scrollTop).toBe(1400)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps a takeover latched while streaming growth stays within the at-bottom tolerance', () => {
    // Expanding a SHORT thinking block near the live edge grows the content by
    // less than the 100px at-bottom tolerance, so right after the takeover the
    // viewport still measures "close to bottom". The size-change must not
    // re-latch at-bottom over the takeover — otherwise the very next chunk
    // re-engages auto-stick and scrolls the revealed content away again (the
    // jitter this latch exists to prevent).
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

      // Drain the mount's scroll-to-newest rAF first so its programmatic stick
      // can't fire during the final tick and masquerade as a re-latch.
      raf.tick(60)

      scrollHeight = 1200
      act(() => callbacks[0]?.([], {} as ResizeObserver))

      // At the live bottom during streaming — auto-stick owns scrollTop.
      scrollTop = 800
      act(() => runtime!.scrollerProps.onScroll(800))
      expect(handle!.isAtBottom()).toBe(true)

      act(() => runtime!.takeUserControl())
      expect(handle!.isAtBottom()).toBe(false)

      // The short expansion grows content by only 40px — still within tolerance.
      scrollHeight = 1240
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(handle!.isAtBottom()).toBe(false)

      // The next streaming chunk must not re-engage bottom-follow.
      scrollHeight = 1300
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(10)
      expect(scrollTop).toBe(800)
      expect(handle!.isAtBottom()).toBe(false)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('a small upward user scroll that releases the top pin must not hand the turn to bottom-follow', () => {
    // Right after a send, the user message is pinned to the top with a spacer
    // filling the viewport below — geometrically the viewport sits within (even
    // past) the EFFECTIVE bottom. A small upward wheel releases the pin; the
    // same scroll event must latch the user out of following, not count as
    // "reached the bottom" via the tolerance and hand the turn to auto-stick.
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
      const view = render(
        <RuntimeDomProbe
          items={['user-msg']}
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
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 400 })
      runtime!.vlistHandleRef.current = createHandle({ getItemOffset: vi.fn(() => 300) })
      raf.tick(60)

      // Send: a fresh streaming turn pins the user message to the top.
      view.rerender(
        <RuntimeDomProbe
          items={['user-msg']}
          handleRef={handleRef}
          preserveScrollAnchor
          scrollToTopKey="user-msg"
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()

      // Settle at the pinned offset (programmatic, keeps the pin).
      scrollTop = 300
      act(() => runtime!.scrollerProps.onScroll(300))

      // The user wheels up a little — beyond the pin's 16px release tolerance
      // but still well within the at-bottom tolerance of the effective bottom.
      scrollTop = 270
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(270)
      })
      expect(handle!.isAtBottom()).toBe(false)

      // Streaming continues — the view must hold, not crawl back to the bottom.
      scrollHeight = 1100
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(10)
      expect(scrollTop).toBe(270)
      expect(handle!.isAtBottom()).toBe(false)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('holds the pinned position when the pin releases under user control instead of handing to bottom-follow', () => {
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
      // Drain the mount's scroll-to-newest restore (it releases any anchor) so
      // it cannot fire after the pin below and silently unpin it.
      raf.tick(60)

      // Send: pin the fresh user message to the top.
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
      scrollTop = 300

      // The user interacts (expands a block, clicks) while the pin holds: the
      // pin keeps holding — same position, one writer — but the takeover is
      // remembered.
      act(() => runtime!.takeUserControl())

      // The reply outgrows the space below the pin, releasing it. Runtime-driven
      // turns hand off to bottom-follow here and snap to the live bottom; under
      // user control the viewport must stay frozen where the pin left it.
      contentHeight = 1600
      act(() => callbacks[callbacks.length - 1]?.([], {} as ResizeObserver))
      raf.tick(10)
      expect(scrollTop).toBe(300)
      expect(handle!.isAtBottom()).toBe(false)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('lets a new user turn take the wheel back from a takeover', () => {
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
      // Drain the mount's scroll-to-newest restore (it releases any anchor) so
      // it cannot fire after the pin below and silently unpin it.
      raf.tick(60)

      // A takeover latched while idle (the user clicked something in the list).
      act(() => runtime!.takeUserControl())

      // Send: a fresh turn begins. Turn boundaries clear the takeover, so the
      // new user message pins to the top and the turn is runtime-driven again.
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
      scrollTop = 300

      // The reply outgrows the pin: with the takeover cleared, the turn hands
      // off to bottom-follow and snaps to the live bottom (it would stay frozen
      // at 300 if the stale takeover had survived the turn boundary).
      contentHeight = 1600
      act(() => callbacks[callbacks.length - 1]?.([], {} as ResizeObserver))
      raf.tick(10)
      expect(scrollTop).toBe(1200)
      expect(handle!.isAtBottom()).toBe(true)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('resumes following after an explicit scroll-to-bottom ends a takeover', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 500
      let scrollHeight = 1200
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
      raf.tick(60)

      // Held mid-stream after a direct interaction.
      act(() => runtime!.takeUserControl())
      scrollHeight = 1400
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(10)
      expect(scrollTop).toBe(500)

      // The scroll-to-bottom affordance is the user choosing the live edge:
      // the runtime drives again and the next growth follows.
      act(() => runtime!.scrollToBottom())
      expect(scrollTop).toBe(1000)
      expect(handle!.isAtBottom()).toBe(true)

      scrollHeight = 1600
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(100)
      expect(scrollTop).toBe(1200)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('ignores a large programmatic backward jump during bottom-follow (no input) and keeps following', () => {
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
      act(() => runtime!.scrollerProps.onScroll(followedOffset))

      // virtua remeasure compensation jumps scrollTop backward by 40 mid-stream —
      // there is NO preceding user input, so it must not cancel the follow.
      const jumpOffset = followedOffset - 40
      scrollTop = jumpOffset
      act(() => runtime!.scrollerProps.onScroll(jumpOffset))
      expect(handle!.isAtBottom()).toBe(true)

      // Streaming continues; bottom-follow is still live and tracks the new bottom.
      scrollHeight = 2200
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(10)
      expect(scrollTop).toBeGreaterThan(jumpOffset)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('reasserts bottom when virtua drifts backward just after a downward return gesture', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 500
      const scrollHeight = 1200
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
      raf.tick(60)

      act(() => runtime!.takeUserControl())
      act(() => runtime!.scrollerProps.onWheel(new WheelEvent('wheel', { deltaY: 600 })))
      scrollTop = 800
      act(() => runtime!.scrollerProps.onScroll(800))
      expect(handle!.isAtBottom()).toBe(true)

      // Virtua remeasures the bottom item in the same input window and moves
      // scrollTop backward without a matching upward wheel. This must not be
      // mistaken for a fresh user takeover or left as visible bottom drift.
      scrollTop = 737.5
      act(() => runtime!.scrollerProps.onScroll(737.5))

      expect(scrollTop).toBe(800)
      expect(handle!.isAtBottom()).toBe(true)
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
