// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProcessRunAutoScroll } from '../useProcessRunAutoScroll'

interface ScrollFixture {
  viewport: HTMLDivElement
  content: HTMLDivElement
  outerScrollTopWrites: number[]
  scrollTopWrites: number[]
  setClientHeight: (height: number) => void
  setScrollHeight: (height: number) => void
}

function createScrollFixture({ clientHeight = 100, scrollHeight = 300 } = {}): ScrollFixture {
  const outer = document.createElement('div')
  const viewport = document.createElement('div')
  const content = document.createElement('div')
  viewport.appendChild(content)
  outer.appendChild(viewport)
  document.body.appendChild(outer)

  let outerScrollTop = 40
  const outerScrollTopWrites: number[] = []
  Object.defineProperty(outer, 'scrollTop', {
    configurable: true,
    get: () => outerScrollTop,
    set: (value: number) => {
      outerScrollTop = value
      outerScrollTopWrites.push(value)
    }
  })

  let currentClientHeight = clientHeight
  let currentScrollHeight = scrollHeight
  let currentScrollTop = 0
  const scrollTopWrites: number[] = []
  Object.defineProperties(viewport, {
    clientHeight: {
      configurable: true,
      get: () => currentClientHeight
    },
    scrollHeight: {
      configurable: true,
      get: () => currentScrollHeight
    },
    scrollTop: {
      configurable: true,
      get: () => currentScrollTop,
      set: (value: number) => {
        currentScrollTop = value
        scrollTopWrites.push(value)
      }
    }
  })

  return {
    viewport,
    content,
    outerScrollTopWrites,
    scrollTopWrites,
    setClientHeight: (height) => {
      currentClientHeight = height
    },
    setScrollHeight: (height) => {
      currentScrollHeight = height
    }
  }
}

describe('useProcessRunAutoScroll', () => {
  const resizeCallbacks: ResizeObserverCallback[] = []
  const observedElements: Element[] = []
  const disconnectedObservers: ReturnType<typeof vi.fn>[] = []
  const frameCallbacks = new Map<number, FrameRequestCallback>()
  let nextFrameId = 1

  const flushFrames = () => {
    const pending = [...frameCallbacks.entries()]
    frameCallbacks.clear()
    act(() => {
      pending.forEach(([, callback]) => callback(performance.now()))
    })
  }

  const notifyResize = () => {
    act(() => {
      resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver))
    })
  }

  beforeEach(() => {
    resizeCallbacks.length = 0
    observedElements.length = 0
    disconnectedObservers.length = 0
    frameCallbacks.clear()
    nextFrameId = 1

    class ResizeObserverMock {
      readonly disconnect = vi.fn()

      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback)
        disconnectedObservers.push(this.disconnect)
      }

      observe(element: Element) {
        observedElements.push(element)
      }

      unobserve() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextFrameId++
        frameCallbacks.set(id, callback)
        return id
      })
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => {
        frameCallbacks.delete(id)
      })
    )
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderAutoScroll(fixture: ScrollFixture, onFollowRestored?: () => void) {
    const hook = renderHook(() => useProcessRunAutoScroll(onFollowRestored))
    act(() => {
      hook.result.current.viewportRef(fixture.viewport)
      hook.result.current.contentRef(fixture.content)
    })
    return hook
  }

  it('coalesces resize notifications into one frame and sticks its own viewport to the bottom', () => {
    const fixture = createScrollFixture()
    renderAutoScroll(fixture)

    expect(observedElements).toEqual([fixture.content, fixture.viewport])
    notifyResize()
    notifyResize()
    expect(frameCallbacks.size).toBe(1)

    flushFrames()
    expect(fixture.viewport.scrollTop).toBe(200)
    expect(fixture.scrollTopWrites).toEqual([200])
    expect(fixture.outerScrollTopWrites).toEqual([])

    fixture.setScrollHeight(500)
    notifyResize()
    notifyResize()
    expect(frameCallbacks.size).toBe(1)

    flushFrames()
    expect(fixture.viewport.scrollTop).toBe(400)
    expect(fixture.scrollTopWrites).toEqual([200, 400])
    expect(fixture.outerScrollTopWrites).toEqual([])
  })

  it('reports overflow only while the viewport has a meaningful scroll range', () => {
    const fixture = createScrollFixture()
    const hook = renderAutoScroll(fixture)

    expect(hook.result.current.hasOverflow).toBe(false)
    flushFrames()
    expect(hook.result.current.hasOverflow).toBe(true)

    fixture.setScrollHeight(100)
    notifyResize()
    flushFrames()
    expect(hook.result.current.hasOverflow).toBe(false)
  })

  it('pauses after a real scroll away and resumes after a real scroll back to the bottom', () => {
    const fixture = createScrollFixture()
    const onFollowRestored = vi.fn()
    renderAutoScroll(fixture, onFollowRestored)
    flushFrames()

    act(() => {
      fixture.viewport.scrollTop = 80
      fixture.viewport.dispatchEvent(new Event('scroll'))
    })
    fixture.setScrollHeight(400)
    notifyResize()
    flushFrames()
    expect(fixture.viewport.scrollTop).toBe(80)

    act(() => {
      fixture.viewport.scrollTop = 300
      fixture.viewport.dispatchEvent(new Event('scroll'))
    })
    expect(onFollowRestored).toHaveBeenCalledOnce()
    fixture.setScrollHeight(500)
    notifyResize()
    flushFrames()
    expect(fixture.viewport.scrollTop).toBe(400)
  })

  it('treats even a small upward movement near the bottom as user intent', () => {
    const fixture = createScrollFixture()
    renderAutoScroll(fixture)
    flushFrames()

    act(() => {
      fixture.viewport.scrollTop = 195
      fixture.viewport.dispatchEvent(new Event('scroll'))
    })
    fixture.setScrollHeight(400)
    notifyResize()
    flushFrames()

    expect(fixture.viewport.scrollTop).toBe(195)
  })

  it('pauses before an overflowing disclosure changes layout', () => {
    const fixture = createScrollFixture()
    const hook = renderAutoScroll(fixture)
    flushFrames()

    act(() => hook.result.current.pauseForInteraction())
    fixture.setScrollHeight(500)
    notifyResize()
    flushFrames()

    expect(fixture.viewport.scrollTop).toBe(200)
    expect(fixture.scrollTopWrites).toEqual([200])
  })

  it('automatically resumes after an interaction when the detail still has no overflow', () => {
    const fixture = createScrollFixture({ clientHeight: 100, scrollHeight: 80 })
    const hook = renderAutoScroll(fixture)
    flushFrames()

    act(() => hook.result.current.pauseForInteraction())
    fixture.setScrollHeight(90)
    notifyResize()
    flushFrames()

    fixture.setScrollHeight(220)
    notifyResize()
    flushFrames()
    expect(fixture.viewport.scrollTop).toBe(120)
  })

  it('resumes after a paused overflowing detail collapses back below the viewport height', () => {
    const fixture = createScrollFixture()
    const hook = renderAutoScroll(fixture)
    flushFrames()

    act(() => hook.result.current.pauseForInteraction())
    fixture.setScrollHeight(500)
    notifyResize()
    flushFrames()
    expect(fixture.viewport.scrollTop).toBe(200)

    fixture.setScrollHeight(80)
    notifyResize()
    flushFrames()
    expect(fixture.viewport.scrollTop).toBe(0)

    fixture.setScrollHeight(250)
    notifyResize()
    flushFrames()
    expect(fixture.viewport.scrollTop).toBe(150)
  })

  it('disconnects the observer and cancels the pending frame on unmount', () => {
    const fixture = createScrollFixture()
    const hook = renderAutoScroll(fixture)
    expect(frameCallbacks.size).toBe(1)

    hook.unmount()

    expect(disconnectedObservers).toHaveLength(1)
    expect(disconnectedObservers[0]).toHaveBeenCalledOnce()
    expect(cancelAnimationFrame).toHaveBeenCalledOnce()
    expect(frameCallbacks.size).toBe(0)
  })
})
