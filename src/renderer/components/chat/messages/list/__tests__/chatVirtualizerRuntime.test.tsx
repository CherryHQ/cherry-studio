import { act, render } from '@testing-library/react'
import { type ReactNode, type Ref } from 'react'
import type { VListHandle } from 'virtua'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

function SelectionRuntimeProbe({
  items,
  onRuntime,
  testId
}: {
  items: string[]
  onRuntime(runtime: ChatVirtualizerRuntime<string>): void
  testId: string
}) {
  const runtime = useChatVirtualizerRuntime({
    items,
    getItemKey: getStringItemKey,
    renderItem: (item): ReactNode => <span>{item}</span>,
    hasMoreTop: false,
    topReachOverscanItems: 4,
    bottomPadding: 12
  })
  onRuntime(runtime)
  return (
    <div
      data-message-virtual-list-scroller
      data-testid={testId}
      ref={(element) => {
        runtime.scrollerRef.current = element
      }}>
      {runtime.wrappedItems.map(runtime.wrappedRenderItem)}
    </div>
  )
}

function selectContents(element: HTMLElement): void {
  const selection = document.getSelection()
  if (!selection) throw new Error('Selection API is unavailable')
  const range = document.createRange()
  range.selectNodeContents(element)
  act(() => {
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
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

function setElementLayoutPresence(element: HTMLElement, hasLayout: () => boolean = () => true): void {
  Object.defineProperty(element, 'getClientRects', {
    configurable: true,
    value: () => (hasLayout() ? [element.getBoundingClientRect()] : []) as unknown as DOMRectList
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
  afterEach(() => {
    document.getSelection()?.removeAllRanges()
  })

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

  it('keeps selection-survival indexes local to their owning virtual list', () => {
    let leftRuntime: ChatVirtualizerRuntime<string> | undefined
    let rightRuntime: ChatVirtualizerRuntime<string> | undefined
    const view = render(
      <>
        <SelectionRuntimeProbe
          items={['left-a', 'left-b', 'left-c', 'left-d']}
          onRuntime={(runtime) => (leftRuntime = runtime)}
          testId="left-list"
        />
        <SelectionRuntimeProbe
          items={['right-a']}
          onRuntime={(runtime) => (rightRuntime = runtime)}
          testId="right-list"
        />
      </>
    )

    selectContents(view.getByText('left-d'))

    expect(leftRuntime?.keepMounted).toEqual([3])
    expect(rightRuntime?.keepMounted).toEqual([])

    selectContents(view.getByText('right-a'))

    expect(leftRuntime?.keepMounted).toEqual([])
    expect(rightRuntime?.keepMounted).toEqual([0])
  })

  it('drops a stale selection-survival index when the virtual list shrinks', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    const view = render(
      <SelectionRuntimeProbe
        items={['message-a', 'message-b', 'message-c', 'message-d']}
        onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        testId="message-list"
      />
    )

    selectContents(view.getByText('message-d'))
    expect(runtime?.keepMounted).toEqual([3])

    view.rerender(
      <SelectionRuntimeProbe
        items={['message-a']}
        onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        testId="message-list"
      />
    )

    expect(runtime?.keepMounted).toEqual([])
  })

  it('keeps scroll handlers stable across parent rerenders', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    const items = ['message-a']
    const view = render(<RuntimeProbe items={items} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    const scrollerProps = runtime?.scrollerProps
    const onWheel = runtime?.scrollerProps.onWheel
    const onScroll = runtime?.scrollerProps.onScroll
    const notifyWheelIntent = runtime?.notifyWheelIntent
    const scrollByWheel = runtime?.scrollByWheel

    view.rerender(<RuntimeProbe items={items} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.scrollerProps).toBe(scrollerProps)
    expect(runtime?.scrollerProps.onWheel).toBe(onWheel)
    expect(runtime?.scrollerProps.onScroll).toBe(onScroll)
    expect(runtime?.notifyWheelIntent).toBe(notifyWheelIntent)
    expect(runtime?.scrollByWheel).toBe(scrollByWheel)
  })

  it('does not recreate resize observers on unrelated parent rerenders', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const observers: Array<{
      disconnect: ReturnType<typeof vi.fn<(...args: any[]) => any>>
      observe: ReturnType<typeof vi.fn<(...args: any[]) => any>>
    }> = []

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

  it('enables shift only for renders that add or remove items at the start', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    const initialItems = ['message-a', 'message-b']
    const prependedItems = ['message-old', 'message-a', 'message-b']
    const removedFromStartItems = ['message-a', 'message-b']
    const appendedItems = ['message-a', 'message-b', 'message-new']
    const view = render(<RuntimeProbe items={initialItems} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.shift).toBe(false)

    view.rerender(<RuntimeProbe items={prependedItems} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.shift).toBe(true)

    view.rerender(<RuntimeProbe items={prependedItems} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.shift).toBe(false)

    view.rerender(<RuntimeProbe items={removedFromStartItems} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.shift).toBe(true)

    view.rerender(<RuntimeProbe items={removedFromStartItems} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.shift).toBe(false)

    view.rerender(<RuntimeProbe items={appendedItems} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.shift).toBe(false)

    view.rerender(<RuntimeProbe items={removedFromStartItems} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)

    expect(runtime?.shift).toBe(false)

    view.rerender(<RuntimeProbe items={[]} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)
    expect(runtime?.shift).toBe(false)

    view.rerender(<RuntimeProbe items={['message-first']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)
    expect(runtime?.shift).toBe(false)
  })

  it('does not claim shift support for an equal-length sliding window', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    const view = render(
      <RuntimeProbe
        items={['message-a', 'message-b', 'message-c']}
        onRuntime={(nextRuntime) => (runtime = nextRuntime)}
      />
    )

    view.rerender(
      <RuntimeProbe
        items={['message-b', 'message-c', 'message-d']}
        onRuntime={(nextRuntime) => (runtime = nextRuntime)}
      />
    )

    expect(runtime?.shift).toBe(false)
  })

  it('does not treat mixed removals as a start shift', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    const view = render(
      <RuntimeProbe
        items={['message-a', 'message-b', 'message-c', 'message-d']}
        onRuntime={(nextRuntime) => (runtime = nextRuntime)}
      />
    )

    view.rerender(
      <RuntimeProbe items={['message-b', 'message-c']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />
    )

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

  it('keeps the scroll-to-bottom button visible during reading navigation while still far from bottom', () => {
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      render(
        <RuntimeProbe
          items={['message-a']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )

      runtime!.scrollerRef.current = {
        scrollTop: 500,
        scrollHeight: 2000,
        clientHeight: 400
      } as HTMLDivElement

      act(() => runtime!.takeUserControl('navigation'))
      expect(runtime!.isScrollToBottomButtonVisible).toBe(true)

      act(() => {
        handle!.scrollToTop('smooth')
        runtime!.scrollerProps.onScroll(500)
      })

      expect(runtime!.isScrollToBottomButtonVisible).toBe(true)
    } finally {
      raf.restore()
    }
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
      runtime!.scrollToBottom()
    })

    expect(scrollTop).toBe(800)
    expect(runtime!.isScrollToBottomButtonVisible).toBe(false)
  })

  it('scrolls to top instantly', () => {
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
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick()

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

      act(() => runtime!.scrollToBottom())
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

  it('jumps instantly to a key more than a few viewports away', () => {
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
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => 4000)
      // message-b sits 2000px away — beyond 3 viewports (3 * 400), so the
      // animation is skipped and the scroller lands on the target immediately.
      runtime!.vlistHandleRef.current = createHandle({
        getItemOffset: vi.fn((index) => index * 2000),
        getItemSize: vi.fn(() => 400)
      })

      act(() => handle!.scrollToKey('message-b', 'start'))

      expect(scrollTop).toBe(2000)
    } finally {
      raf.restore()
    }
  })

  it('scrolls smoothly to a nearby key within a few viewports', () => {
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
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => 4000)
      // message-b sits 500px away — within 3 viewports, so it animates.
      runtime!.vlistHandleRef.current = createHandle({
        getItemOffset: vi.fn((index) => index * 500),
        getItemSize: vi.fn(() => 400)
      })

      act(() => handle!.scrollToKey('message-b', 'start'))
      expect(scrollTop).toBe(0)

      raf.tick(60)
      expect(scrollTop).toBe(500)
    } finally {
      raf.restore()
    }
  })

  it('scrolls smoothly when the raw offset overshoots the reachable bottom but the real movement is short', () => {
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 3400
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
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => 4000)
      // message-b's raw offset (6000px) is far past the reachable bottom
      // (3600px). The raw distance (2600px) exceeds 3 viewports, but the real
      // movement is only 200px — so it must animate, not jump.
      runtime!.vlistHandleRef.current = createHandle({
        getItemOffset: vi.fn((index) => index * 6000),
        getItemSize: vi.fn(() => 400)
      })

      act(() => handle!.scrollToKey('message-b', 'start'))
      expect(scrollTop).toBe(3400)

      raf.tick(60)
      expect(scrollTop).toBe(3600)
    } finally {
      raf.restore()
    }
  })

  it('jumps instantly when even the clamped movement exceeds a few viewports', () => {
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
      setElementMetric(scroller, 'clientHeight', () => 400)
      setElementMetric(scroller, 'scrollHeight', () => 4000)
      // message-b's raw offset (6000px) clamps to the reachable bottom
      // (3600px), still more than 3 viewports away — so it jumps instantly.
      runtime!.vlistHandleRef.current = createHandle({
        getItemOffset: vi.fn((index) => index * 6000),
        getItemSize: vi.fn(() => 400)
      })

      act(() => handle!.scrollToKey('message-b', 'start'))

      expect(scrollTop).toBe(3600)
    } finally {
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
      setElementLayoutPresence(heading)
      blockWrapper.append(heading)
      message.append(blockWrapper)
      runtime!.contentRef.current!.prepend(message)

      act(() => runtime!.scrollToBottom())
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

  it('measures an exact range once and completes its navigation immediately', () => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    let handle: MessageVirtualListHandle | null = null
    const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
      handle = nextHandle
    }
    let scrollTop = 1000
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
    setElementMetric(scroller, 'clientHeight', () => 400)
    setElementMetric(scroller, 'scrollHeight', () => 1600)
    Object.defineProperty(scroller, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, bottom: 400, left: 0, right: 800, width: 800, height: 400, x: 0, y: 0 })
    })

    const message = document.createElement('div')
    message.dataset.messageKey = 'message-a'
    const text = document.createTextNode('matched text')
    message.append(text)
    runtime!.contentRef.current!.prepend(message)
    const range = document.createRange()
    range.selectNodeContents(text)
    const getRangeRect = vi.fn(() => ({
      top: 90,
      bottom: 110,
      left: 0,
      right: 100,
      width: 100,
      height: 20,
      x: 0,
      y: 90
    }))
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: getRangeRect
    })
    act(() => handle!.scrollToBottom())
    expect(handle!.isFollowing()).toBe(true)
    act(() => handle!.scrollToRange(range))
    expect(scrollTop).toBe(1100)
    expect(getRangeRect).toHaveBeenCalledTimes(1)
    expect(handle!.isFollowing()).toBe(false)
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
        handle!.scrollToBottom()
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
        handle!.scrollToBottom()
      })
      raf.tick()
      expect(scrollTop).toBeGreaterThan(topScrollProgress)

      raf.tick(50)
      expect(scrollTop).toBe(800)
    } finally {
      raf.restore()
    }
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

      // Before the viewport reaches the live bottom, content growth must not
      // establish bottom-follow by itself.
      scrollHeight = 1200
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(0)

      // The user scrolls to the bottom (1200 - 400 = 800): they take control and
      // bottom-follow re-engages.
      scrollTop = 800
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(800)
      })

      // The next large chunk sticks to the fresh bottom synchronously.
      scrollHeight = 2000
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(1600)
      expect(handle!.isFollowing()).toBe(true)
      expect(runtime!.contentRef.current!.style.transform).toBe('')

      raf.tick()
      expect(scrollTop).toBe(1600)

      // A subsequent render reconciles to the new live edge immediately too.
      scrollHeight = 2200
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(handle!.isFollowing()).toBe(true)
      expect(scrollTop).toBe(1800)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('sticks exactly to the live edge for visible single-line growth', () => {
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
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(800)
      })

      scrollHeight = 1220
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(820)
      expect(handle!.isFollowing()).toBe(true)

      raf.tick()
      expect(scrollTop).toBe(820)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps following when a message is appended at the live bottom', () => {
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
      setElementMetric(scroller, 'scrollHeight', () => scrollHeight)
      setElementMetric(scroller, 'clientHeight', () => 400)
      runtime!.vlistHandleRef.current = createHandle()
      raf.tick(60)

      act(() => handle!.scrollToBottom())
      expect(scrollTop).toBe(600)

      view.rerender(
        <RuntimeDomProbe
          items={['message-a', 'message-b']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      expect(scrollTop).toBe(600)

      scrollHeight = 1200
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(60)

      expect(scrollTop).toBe(800)
      expect(handle!.isFollowing()).toBe(true)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps the reading position when history and a local turn are appended together', () => {
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 400
      let scrollHeight = 1200
      const view = render(
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
      setElementMetric(scroller, 'scrollHeight', () => scrollHeight)
      setElementMetric(scroller, 'clientHeight', () => 400)
      runtime!.vlistHandleRef.current = createHandle()
      raf.tick(60)

      act(() => runtime!.takeUserControl('user-scrolled-up'))
      scrollHeight = 1400
      view.rerender(
        <RuntimeDomProbe
          items={['older-message', 'message-a', 'message-b', 'sent-user-message', 'pending-assistant']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )

      expect(scrollTop).toBe(400)
      expect(handle!.isFollowing()).toBe(false)
    } finally {
      raf.restore()
    }
  })

  it('keeps reading mode through branch shrink and subsequent growth', () => {
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
      const view = render(
        <RuntimeDomProbe
          items={['history-message']}
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
      setElementMetric(scroller, 'scrollHeight', () => scrollHeight)
      setElementMetric(scroller, 'clientHeight', () => 400)
      runtime!.vlistHandleRef.current = createHandle()
      raf.tick(60)

      act(() => runtime!.takeUserControl('user-scrolled-up'))
      scrollHeight = 1000
      view.rerender(
        <RuntimeDomProbe
          items={['edited-user-message', 'pending-assistant']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(500)

      view.rerender(
        <RuntimeDomProbe
          items={['edited-user-message', 'pending-assistant']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )

      expect(scrollTop).toBe(500)

      scrollHeight = 1200
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(60)

      expect(scrollTop).toBe(500)
      expect(handle!.isFollowing()).toBe(false)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps the pre-fork reading position when a non-scrolling interaction follows the branch shrink', () => {
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
      let scrollHeight = 1800
      const view = render(
        <RuntimeDomProbe
          items={['history-message']}
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
      setElementMetric(scroller, 'scrollHeight', () => scrollHeight)
      setElementMetric(scroller, 'clientHeight', () => 400)
      runtime!.vlistHandleRef.current = createHandle()
      raf.tick(60)

      act(() => runtime!.takeUserControl('user-scrolled-up'))
      scrollHeight = 1000
      view.rerender(
        <RuntimeDomProbe
          items={['edited-user-message', 'pending-assistant']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(500)
      act(() => runtime!.takeUserControl('user-scrolled-up'))

      view.rerender(
        <RuntimeDomProbe
          items={['edited-user-message', 'pending-assistant']}
          handleRef={handleRef}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      raf.tick(60)

      expect(scrollTop).toBe(500)
      expect(handle!.isFollowing()).toBe(false)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps the reading position when a sent message and streamed content are appended', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 300
      let scrollHeight = 1200
      const view = render(
        <RuntimeDomProbe items={['history-message']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />
      )
      const scroller = runtime!.scrollerRef.current!
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value
        }
      })
      setElementMetric(scroller, 'scrollHeight', () => scrollHeight)
      setElementMetric(scroller, 'clientHeight', () => 400)
      runtime!.vlistHandleRef.current = createHandle()
      raf.tick(60)

      act(() => runtime!.takeUserControl('user-scrolled-up'))
      expect(scrollTop).toBe(300)

      view.rerender(
        <RuntimeDomProbe
          items={['history-message', 'sent-user-message']}
          onRuntime={(nextRuntime) => (runtime = nextRuntime)}
        />
      )
      expect(scrollTop).toBe(300)

      scrollHeight = 1400
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(20)
      expect(scrollTop).toBe(300)

      scrollHeight = 1500
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(20)
      expect(scrollTop).toBe(300)
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
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(800)
      })
      expect(handle!.isFollowing()).toBe(true)

      scrollHeight = 2000
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick()
      const followedOffset = scrollTop
      expect(followedOffset).toBeGreaterThan(800)

      act(() => runtime!.scrollerProps.onScroll(followedOffset))

      // A real non-wheel upward gesture (scrollbar drag) fires pointerdown, which
      // the host reports via markUserInput; that's what makes this a takeover
      // rather than a programmatic remeasure jump (which must NOT take over).
      const userOffset = followedOffset - 1
      scrollTop = userOffset
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(userOffset)
      })
      expect(handle!.isFollowing()).toBe(false)

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
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(800)
      })
      expect(handle!.isFollowing()).toBe(true)

      // An explicit disclosure action enters reading mode and freezes the
      // viewport. Ordinary pointer/key interaction is intentionally ignored.
      act(() => runtime!.takeUserControl('disclosure'))
      expect(handle!.isFollowing()).toBe(false)

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

  it('keeps reading after a disclosure closes at the real bottom', () => {
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
      expect(handle!.isFollowing()).toBe(true)
      act(() => runtime!.takeUserControl('disclosure'))
      expect(handle!.isFollowing()).toBe(false)

      raf.tick(2)
      expect(handle!.isFollowing()).toBe(false)

      scrollHeight = 1400
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(20)
      expect(scrollTop).toBe(800)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps disclosure reading intent when shrink creates freeze slack', () => {
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
      act(() => runtime!.takeUserControl('disclosure'))

      naturalScrollHeight = 700
      scrollTop = 300
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(runtime!.freezeSpacerRef.current).toHaveStyle({ height: '500px' })
      expect(scrollTop).toBe(800)

      raf.tick(2)

      expect(runtime!.freezeSpacerRef.current).toHaveStyle({ height: '500px' })
      expect(scrollTop).toBe(800)
      expect(handle!.isFollowing()).toBe(false)

      naturalScrollHeight = 900
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(20)
      expect(scrollTop).toBe(800)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps reading mode when disclosure shrink passes the viewport', () => {
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
      act(() => runtime!.takeUserControl('disclosure'))

      // The collapse moves the new real bottom above the preserved reading
      // position. Freeze slack restores that position after the browser clamp.
      naturalScrollHeight = 700
      scrollTop = 300
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(runtime!.freezeSpacerRef.current).toHaveStyle({ height: '500px' })
      expect(scrollTop).toBe(600)

      // Layout clamp and temporary slack must not reinterpret the mode as
      // following; only a real user arrival at the bottom can do that.
      raf.tick(2)
      expect(runtime!.freezeSpacerRef.current).toHaveStyle({ height: '500px' })
      expect(scrollTop).toBe(600)
      expect(handle!.isFollowing()).toBe(false)
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
      act(() => runtime!.takeUserControl('user-scrolled-up'))

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
      act(() => runtime!.takeUserControl('user-scrolled-up'))

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

    act(() => runtime!.takeUserControl('user-scrolled-up'))

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

      act(() => runtime!.takeUserControl('user-scrolled-up'))

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

      act(() => runtime!.takeUserControl('user-scrolled-up'))
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

  it('keeps native scrollbar ownership while the held thumb reverses direction', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 1200
      let naturalScrollHeight = 2000
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

      act(() => {
        runtime!.beginScrollbarDrag()
        runtime!.takeUserControl('user-scrolled-up')
        scrollTop = 600
        runtime!.scrollerProps.onScroll(600)
      })

      // Measuring the newly visited rows changes virtua's natural extent. It
      // must not be converted into freeze slack while the thumb is held.
      naturalScrollHeight = 1500
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(Number.parseFloat(runtime!.freezeSpacerRef.current?.style.height || '0')).toBe(0)

      // virtua may report scroll-end during the pause before the user reverses.
      act(() => runtime!.scrollerProps.onScrollEnd())
      act(() => {
        scrollTop = 900
        runtime!.scrollerProps.onScroll(900)
      })

      expect(scrollTop).toBe(900)
      expect(Number.parseFloat(runtime!.freezeSpacerRef.current?.style.height || '0')).toBe(0)

      act(() => runtime!.endScrollbarDrag())

      // Once released, ordinary resting-position protection is active again.
      naturalScrollHeight = 1400
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(runtime!.freezeSpacerRef.current).toHaveStyle({ height: '100px' })
      expect(scrollTop).toBe(900)
    } finally {
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
      setElementLayoutPresence(toggle)
      item.append(toggle)
      runtime!.contentRef.current!.prepend(item)

      act(() => runtime!.takeUserControl('disclosure', toggle))

      // Content above the toggle reflows inside the same MessageGroup. The
      // virtual item's start offset is unchanged, but the interacted element moved.
      anchorTop = 170
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(550)
    } finally {
      restoreResizeObserver()
    }
  })

  it('falls back to the message item when the semantic anchor is hidden', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 500
      let anchorTop = 120
      let hasLayout = true
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

      const item = document.createElement('div')
      item.dataset.messageKey = 'message-a'
      const anchor = document.createElement('button')
      Object.defineProperty(anchor, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: anchorTop })
      })
      setElementLayoutPresence(anchor, () => hasLayout)
      item.append(anchor)
      runtime!.contentRef.current!.prepend(item)

      act(() => runtime!.takeUserControl('disclosure', anchor))

      // A hidden semantic node stays connected but no longer has a layout box.
      // The stable message item must take over instead of treating its zero rect
      // as real movement and writing a new outer scrollTop.
      hasLayout = false
      anchorTop = 0
      act(() => callbacks[0]?.([], {} as ResizeObserver))

      expect(scrollTop).toBe(500)
    } finally {
      restoreResizeObserver()
    }
  })

  it('anchors to the nested scroll container instead of an element inside its scrolled content', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 500
      let paragraphTop = 220
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

      const item = document.createElement('div')
      item.dataset.messageKey = 'message-a'
      const region = document.createElement('div')
      region.style.overflowY = 'auto'
      setElementMetric(region, 'clientHeight', () => 100)
      setElementMetric(region, 'scrollHeight', () => 300)
      Object.defineProperty(region, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: 200 })
      })
      setElementLayoutPresence(region)
      const paragraph = document.createElement('p')
      Object.defineProperty(paragraph, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: paragraphTop })
      })
      setElementLayoutPresence(paragraph)
      region.append(paragraph)
      item.append(region)
      runtime!.contentRef.current!.prepend(item)

      act(() => runtime!.takeUserControl('disclosure', paragraph))

      // The user scrolls the nested region on its own: the paragraph moves, the
      // scroll container's border box does not. The freeze must be anchored to
      // the container, so the inner scroll delta never rewrites outer scrollTop.
      paragraphTop = 120
      act(() => callbacks[0]?.([], {} as ResizeObserver))

      expect(scrollTop).toBe(500)
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

      act(() => runtime!.takeUserControl('user-scrolled-up'))

      naturalScrollHeight = 700
      scrollTop = 300 // browser clamp after the collapse
      act(() => callbacks[0]?.([], {} as ResizeObserver))

      expect(runtime!.freezeSpacerRef.current).toHaveStyle({ height: '500px' })
      expect(scrollTop).toBe(800)
    } finally {
      restoreResizeObserver()
    }
  })

  it('keeps user ownership across rerenders so late layout stays anchored', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 500
      const view = render(
        <RuntimeDomProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />
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

      act(() => runtime!.takeUserControl('user-scrolled-up'))
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
      act(() => runtime!.takeUserControl('user-scrolled-up'))
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

  it.each([
    [-480, -200],
    [480, 200]
  ])('owns forwarded wheel scrolling and bounds deltaY %s to %s', (deltaY, boundedDeltaY) => {
    let runtime: ChatVirtualizerRuntime<string> | undefined
    render(<RuntimeDomProbe items={['message-a']} onRuntime={(nextRuntime) => (runtime = nextRuntime)} />)
    const scroller = runtime!.scrollerRef.current!
    const scrollBy = vi.fn()
    scroller.scrollBy = scrollBy

    let didScroll = false
    act(() => {
      didScroll = runtime!.scrollByWheel(deltaY)
    })

    expect(didScroll).toBe(true)
    expect(scrollBy).toHaveBeenCalledWith({ top: boundedDeltaY })
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

      act(() => runtime!.scrollToBottom())
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
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(800)
      })
      expect(handle!.isFollowing()).toBe(true)

      // A direct interaction freezes the viewport mid-stream.
      act(() => runtime!.takeUserControl('user-scrolled-up'))
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
      expect(handle!.isFollowing()).toBe(true)

      scrollHeight = 1800
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(100)
      expect(scrollTop).toBe(1400)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('keeps reading intent through small streaming growth near the live edge', () => {
    // Geometry close to the bottom cannot reinterpret explicit reading intent.
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

      // Drain the mount's scroll-to-newest rAF first.
      raf.tick(60)

      scrollHeight = 1200
      act(() => callbacks[0]?.([], {} as ResizeObserver))

      // At the live bottom during streaming — auto-stick owns scrollTop.
      scrollTop = 800
      act(() => runtime!.scrollerProps.onScroll(800))
      expect(handle!.isFollowing()).toBe(true)

      act(() => runtime!.takeUserControl('user-scrolled-up'))
      expect(handle!.isFollowing()).toBe(false)

      // The short expansion grows content by only 40px.
      scrollHeight = 1240
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(handle!.isFollowing()).toBe(false)

      // The next streaming chunk must not reinterpret the mode either.
      scrollHeight = 1300
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(10)
      expect(scrollTop).toBe(800)
      expect(handle!.isFollowing()).toBe(false)
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
      act(() => runtime!.takeUserControl('user-scrolled-up'))
      scrollHeight = 1400
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick(10)
      expect(scrollTop).toBe(500)

      // The scroll-to-bottom affordance is the user choosing the live edge:
      // the runtime drives again and the next growth follows.
      act(() => runtime!.scrollToBottom())
      expect(scrollTop).toBe(1000)
      expect(handle!.isFollowing()).toBe(true)

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
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(800)
      })
      expect(handle!.isFollowing()).toBe(true)

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
      expect(handle!.isFollowing()).toBe(true)

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

      act(() => runtime!.takeUserControl('user-scrolled-up'))
      act(() => runtime!.scrollerProps.onWheel(new WheelEvent('wheel', { deltaY: 600 })))
      scrollTop = 800
      act(() => runtime!.scrollerProps.onScroll(800))
      expect(handle!.isFollowing()).toBe(true)

      // Virtua remeasures the bottom item in the same input window and moves
      // scrollTop backward without a matching upward wheel. This must not be
      // mistaken for a fresh user takeover or left as visible bottom drift.
      scrollTop = 737.5
      act(() => runtime!.scrollerProps.onScroll(737.5))

      expect(scrollTop).toBe(800)
      expect(handle!.isFollowing()).toBe(true)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('ignores programmatic upward jitter during bottom-follow and keeps following', () => {
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
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(800)
      })
      expect(handle!.isFollowing()).toBe(true)

      scrollHeight = 2000
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      raf.tick()
      const followedOffset = scrollTop
      expect(followedOffset).toBeGreaterThan(800)

      // Sync the observed offset to the programmatic follow position.
      act(() => runtime!.scrollerProps.onScroll(followedOffset))

      // A tiny upward drift without user input must not cancel the follow.
      const jitterOffset = followedOffset - 3
      scrollTop = jitterOffset
      act(() => runtime!.scrollerProps.onScroll(jitterOffset))
      expect(handle!.isFollowing()).toBe(true)

      // The following owner restores the exact live bottom (2000 - 400).
      raf.tick(100)
      expect(scrollTop).toBe(1600)
      expect(handle!.isFollowing()).toBe(true)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('sticks straight to the live bottom for one-shot growth', () => {
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
      act(() => {
        runtime!.markUserInput()
        runtime!.scrollerProps.onScroll(800)
      })
      expect(handle!.isFollowing()).toBe(true)

      // A single render adds more than three viewports and still reconciles in
      // the same callback without an animation.
      scrollHeight = 2500
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(2100)
      expect(handle!.isFollowing()).toBe(true)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })

  it('cancels read navigation when a real downward scroll interrupts the animation', () => {
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
      expect(midFlight).toBeLessThan(800)

      // A PageDown-style input scrolls *down* while the animation runs up.
      // The animation must die where the user put the viewport instead of
      // rewriting scrollTop on its next frame.
      const interrupted = midFlight + 120
      act(() => {
        runtime!.markUserInput()
        scrollTop = interrupted
        runtime!.scrollerProps.onScroll(interrupted)
      })
      raf.tick(10)
      expect(scrollTop).toBe(interrupted)
      expect(handle!.isFollowing()).toBe(false)
    } finally {
      raf.restore()
    }
  })

  it('resumes following when a real jump lands on the live bottom mid-navigation', () => {
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
      expect(scrollTop).toBeLessThan(800)

      // An End-style jump goes straight to the live bottom (2000 - 400): the
      // animation is cancelled and the user's destination hands the wheel back.
      act(() => {
        runtime!.markUserInput()
        scrollTop = 1600
        runtime!.scrollerProps.onScroll(1600)
      })
      expect(handle!.isFollowing()).toBe(true)
      raf.tick(10)
      expect(scrollTop).toBe(1600)
    } finally {
      raf.restore()
    }
  })

  it('does not resume following when latched compensation lands on the live bottom', () => {
    let now = 1_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now)

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let handle: MessageVirtualListHandle | null = null
      const handleRef: Ref<MessageVirtualListHandle> = (nextHandle) => {
        handle = nextHandle
      }
      let scrollTop = 1200
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
      setElementMetric(scroller, 'scrollHeight', () => 2000)
      setElementMetric(scroller, 'clientHeight', () => 400)
      runtime!.vlistHandleRef.current = createHandle()

      act(() => runtime!.takeUserControl('user-scrolled-up'))
      now = 1_010
      act(() => {
        runtime!.markUserInput()
        scrollTop = 1400
        runtime!.scrollerProps.onScroll(1400)
      })
      expect(handle!.isFollowing()).toBe(false)

      // Long after the real input, virtua compensation inside the still-latched
      // gesture happens to land exactly on the live bottom. Without fresh user
      // intent that must not hand the wheel back.
      now = 2_000
      act(() => {
        scrollTop = 1600
        runtime!.scrollerProps.onScroll(1600)
      })
      expect(handle!.isFollowing()).toBe(false)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('keeps the navigation target anchored after virtua reports scroll-end', () => {
    const callbacks: ResizeObserverCallback[] = []
    const restoreResizeObserver = installResizeObserverMock(callbacks)
    const raf = installQueuedAnimationFrame()

    try {
      let runtime: ChatVirtualizerRuntime<string> | undefined
      let scrollTop = 800
      let anchorAbsoluteTop = 950
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
      setElementMetric(scroller, 'scrollHeight', () => 2000)
      setElementMetric(scroller, 'clientHeight', () => 400)
      runtime!.vlistHandleRef.current = createHandle()

      const item = document.createElement('div')
      item.dataset.messageKey = 'message-a'
      const heading = document.createElement('h2')
      Object.defineProperty(heading, 'getBoundingClientRect', {
        configurable: true,
        value: () => {
          const top = anchorAbsoluteTop - scrollTop
          return { top, bottom: top + 32, left: 0, right: 200, width: 200, height: 32, x: 0, y: top }
        }
      })
      setElementLayoutPresence(heading)
      item.append(heading)
      runtime!.contentRef.current!.prepend(item)

      act(() => runtime!.scrollToElement(heading))
      raf.tick(60)
      expect(scrollTop).toBe(950)

      // virtua synthesizes scroll-end after the animation's quiet period. The
      // semantic target captured at navigation completion must survive it.
      act(() => runtime!.scrollerProps.onScrollEnd())

      // Async reflow moves the heading: the runtime keeps the *heading*
      // anchored, not whatever element sat at the viewport top at scroll-end.
      anchorAbsoluteTop = 1010
      act(() => callbacks[0]?.([], {} as ResizeObserver))
      expect(scrollTop).toBe(1010)
    } finally {
      restoreResizeObserver()
      raf.restore()
    }
  })
})
