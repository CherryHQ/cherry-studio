import { act, renderHook } from '@testing-library/react'
import type { RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAutoLoadMore } from '../useAutoLoadMore'

const setContainerSize = (container: HTMLElement, clientHeight: number, scrollHeight: number) => {
  Object.defineProperties(container, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight }
  })
}

describe('useAutoLoadMore', () => {
  const animationFrameCallbacks: FrameRequestCallback[] = []
  const observe = vi.fn()
  const disconnect = vi.fn()
  let resizeObserverCallback: ResizeObserverCallback
  const originalResizeObserver = globalThis.ResizeObserver

  beforeEach(() => {
    animationFrameCallbacks.length = 0
    observe.mockReset()
    disconnect.mockReset()
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeObserverCallback = callback
        }

        observe = observe
        unobserve = vi.fn()
        disconnect = disconnect
      }
    )
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrameCallbacks.push(callback)
      return animationFrameCallbacks.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.ResizeObserver = originalResizeObserver
  })

  const flushAnimationFrames = () => {
    act(() => {
      const callbacks = animationFrameCallbacks.splice(0)
      callbacks.forEach((callback) => callback(performance.now()))
    })
  }

  const notifyResize = () => {
    act(() => {
      resizeObserverCallback([], {} as ResizeObserver)
    })
  }

  const renderAutoLoadMore = ({
    containerRef,
    itemCount = 5,
    hasMore = true,
    isLoading = false,
    loadMore = vi.fn()
  }: {
    containerRef: RefObject<HTMLElement | null>
    itemCount?: number
    hasMore?: boolean
    isLoading?: boolean
    loadMore?: () => void
  }) =>
    renderHook((props) => useAutoLoadMore({ containerRef, loadMore, ...props }), {
      initialProps: { itemCount, hasMore, isLoading }
    })

  it('loads another page when visible content does not fill the container', () => {
    const container = document.createElement('div')
    setContainerSize(container, 600, 480)
    const loadMore = vi.fn()

    renderAutoLoadMore({ containerRef: { current: container }, loadMore })
    flushAnimationFrames()

    expect(loadMore).toHaveBeenCalledOnce()
  })

  it('waits for scrolling when content already overflows the container', () => {
    const container = document.createElement('div')
    setContainerSize(container, 600, 601)
    const loadMore = vi.fn()

    renderAutoLoadMore({ containerRef: { current: container }, loadMore })
    flushAnimationFrames()

    expect(loadMore).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'there are no more items', hasMore: false, isLoading: false },
    { name: 'another page is loading', hasMore: true, isLoading: true }
  ])('does not schedule a measurement when $name', ({ hasMore, isLoading }) => {
    const container = document.createElement('div')
    setContainerSize(container, 600, 480)
    const loadMore = vi.fn()

    renderAutoLoadMore({ containerRef: { current: container }, hasMore, isLoading, loadMore })

    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    expect(loadMore).not.toHaveBeenCalled()
  })

  it('does not load for a hidden container', () => {
    const container = document.createElement('div')
    setContainerSize(container, 0, 0)
    const loadMore = vi.fn()

    renderAutoLoadMore({ containerRef: { current: container }, loadMore })
    flushAnimationFrames()

    expect(loadMore).not.toHaveBeenCalled()
  })

  it('checks again after the rendered item count changes', () => {
    const container = document.createElement('div')
    setContainerSize(container, 600, 480)
    const containerRef = { current: container }
    const loadMore = vi.fn()
    const { rerender } = renderAutoLoadMore({ containerRef, loadMore })

    flushAnimationFrames()
    expect(loadMore).toHaveBeenCalledOnce()

    rerender({ itemCount: 10, hasMore: true, isLoading: false })
    flushAnimationFrames()

    expect(loadMore).toHaveBeenCalledTimes(2)
  })

  it('checks again when resizing makes the content underfill the container', () => {
    const container = document.createElement('div')
    setContainerSize(container, 600, 601)
    const loadMore = vi.fn()

    renderAutoLoadMore({ containerRef: { current: container }, loadMore })
    flushAnimationFrames()
    expect(loadMore).not.toHaveBeenCalled()

    setContainerSize(container, 700, 601)
    notifyResize()
    flushAnimationFrames()

    expect(loadMore).toHaveBeenCalledOnce()
  })

  it('coalesces resize measurements and disconnects the observer on cleanup', () => {
    const container = document.createElement('div')
    setContainerSize(container, 600, 480)
    const loadMore = vi.fn()
    const { unmount } = renderAutoLoadMore({ containerRef: { current: container }, loadMore })

    expect(observe).toHaveBeenCalledWith(container)
    notifyResize()
    notifyResize()
    flushAnimationFrames()

    expect(loadMore).toHaveBeenCalledOnce()

    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
