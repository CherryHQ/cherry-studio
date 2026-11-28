import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render } from '@testing-library/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatLayoutModeProvider, useChatLayoutMode } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'

import { ChatNarrowWidthHandles } from '../ChatNarrowWidthHandles'
import {
  CHAT_NARROW_DEFAULT_WIDTH,
  CHAT_NARROW_MAX_WIDTH,
  CHAT_NARROW_MIN_WIDTH,
  CHAT_NARROW_SIDE_PADDING_TOTAL,
  CHAT_NARROW_WIDTH_CACHE_KEY,
  CHAT_NARROW_WIDTH_CSS_VAR
} from '../paneLayout'
import {
  CHAT_NARROW_SNAP_THRESHOLD,
  clampChatNarrowWidth,
  computeSymmetricNarrowWidth
} from '../useChatNarrowWidthResize'

function mockElementWidth(element: HTMLElement, width: number) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width,
      height: 600,
      top: 0,
      left: 0,
      right: width,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
  })
}

function Harness({
  visible = true,
  stageWidth,
  forceWideLayout = false
}: {
  visible?: boolean
  stageWidth?: number
  forceWideLayout?: boolean
}) {
  const [, setTick] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const setStageRef = (node: HTMLDivElement | null) => {
    stageRef.current = node
    if (node && stageWidth !== undefined) {
      mockElementWidth(node, stageWidth)
    }
  }

  useEffect(() => {
    const unsubPersist = MockUseCacheUtils.addPersistSubscriber(CHAT_NARROW_WIDTH_CACHE_KEY, () =>
      setTick((n) => n + 1)
    )
    const unsubPref = MockUsePreferenceUtils.addSubscriber('chat.narrow_mode', () => setTick((n) => n + 1))
    return () => {
      unsubPersist()
      unsubPref()
    }
  }, [])

  return (
    <WindowFrameProvider value={{ mode: 'embedded' }}>
      <ChatLayoutModeProvider>
        <ForceWideBridge forceWideLayout={forceWideLayout}>
          <div ref={setStageRef} data-testid="stage" className="relative h-[600px] w-full">
            <ChatNarrowWidthHandles stageRef={stageRef} visible={visible} />
          </div>
        </ForceWideBridge>
      </ChatLayoutModeProvider>
    </WindowFrameProvider>
  )
}

function ForceWideBridge({ forceWideLayout, children }: { forceWideLayout: boolean; children: ReactNode }) {
  const { setForceWideLayout } = useChatLayoutMode()
  useEffect(() => {
    setForceWideLayout(forceWideLayout)
  }, [forceWideLayout, setForceWideLayout])
  return <>{children}</>
}

describe('useChatNarrowWidthResize & ChatNarrowWidthHandles', () => {
  const originalResizeObserver = globalThis.ResizeObserver

  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('chat.narrow_mode', true)
    MockUseCacheUtils.setPersistCacheValue(CHAT_NARROW_WIDTH_CACHE_KEY, CHAT_NARROW_DEFAULT_WIDTH)
    document.documentElement.style.removeProperty(CHAT_NARROW_WIDTH_CSS_VAR)
    delete document.documentElement.dataset.chatNarrowResizing
  })

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    document.documentElement.style.removeProperty(CHAT_NARROW_WIDTH_CSS_VAR)
    delete document.documentElement.dataset.chatNarrowResizing
  })

  it('computes symmetric width deltas and clamps to bounds', () => {
    expect(clampChatNarrowWidth(Number.NaN)).toBe(CHAT_NARROW_DEFAULT_WIDTH)
    expect(clampChatNarrowWidth(400)).toBe(CHAT_NARROW_MIN_WIDTH)
    expect(clampChatNarrowWidth(3000)).toBe(CHAT_NARROW_MAX_WIDTH)
    expect(clampChatNarrowWidth(1200, 950)).toBe(950)

    expect(
      computeSymmetricNarrowWidth({
        side: 'right',
        startWidth: 800,
        startClientX: 500,
        currentClientX: 550,
        maxAvailableWidth: 1200
      })
    ).toBe(900)

    expect(
      computeSymmetricNarrowWidth({
        side: 'left',
        startWidth: 800,
        startClientX: 500,
        currentClientX: 450,
        maxAvailableWidth: 1200
      })
    ).toBe(900)

    expect(
      computeSymmetricNarrowWidth({
        side: 'left',
        startWidth: 800,
        startClientX: 500,
        currentClientX: 550,
        maxAvailableWidth: 1200
      })
    ).toBe(700)

    expect(
      computeSymmetricNarrowWidth({
        side: 'right',
        startWidth: 700,
        startClientX: 500,
        currentClientX: 552,
        maxAvailableWidth: 1200,
        snapToDefaultThreshold: CHAT_NARROW_SNAP_THRESHOLD
      })
    ).toBe(CHAT_NARROW_DEFAULT_WIDTH)

    expect(
      computeSymmetricNarrowWidth({
        side: 'right',
        startWidth: 700,
        startClientX: 500,
        currentClientX: 560,
        maxAvailableWidth: 1200,
        snapToDefaultThreshold: CHAT_NARROW_SNAP_THRESHOLD
      })
    ).toBe(820)
  })

  it('updates CSS var and live width badge on drag, snaps near default, and persists once on mouseup', () => {
    const { container } = render(<Harness stageWidth={1400} />)
    const overlay = container.querySelector<HTMLElement>('[data-chat-narrow-resize-overlay]')!
    const rightHandle = container.querySelector<HTMLElement>('[data-chat-narrow-resize-handle="right"]')!
    expect(rightHandle).toBeInTheDocument()
    expect(document.documentElement.style.getPropertyValue(CHAT_NARROW_WIDTH_CSS_VAR)).toBe('800px')
    expect(container.querySelector('[data-chat-narrow-width-badge]')).toBeNull()

    fireEvent.mouseEnter(rightHandle, { clientY: 320 })
    expect(overlay).toHaveAttribute('data-hovered-side', 'right')

    fireEvent.mouseDown(rightHandle, { clientX: 900, clientY: 320 })
    expect(document.documentElement.dataset.chatNarrowResizing).toBe('true')
    const badge = container.querySelector<HTMLElement>('[data-chat-narrow-width-badge]')!
    expect(badge).toHaveTextContent('800px')

    fireEvent(document, new MouseEvent('mousemove', { clientX: 960, clientY: 340 }))
    expect(document.documentElement.style.getPropertyValue(CHAT_NARROW_WIDTH_CSS_VAR)).toBe('920px')
    expect(badge).toHaveTextContent('920px')
    expect(MockUseCacheUtils.getAllCacheValues().persist[CHAT_NARROW_WIDTH_CACHE_KEY]).toBe(800)

    fireEvent(document, new MouseEvent('mouseup'))
    expect(document.documentElement.dataset.chatNarrowResizing).toBeUndefined()
    expect(container.querySelector('[data-chat-narrow-width-badge]')).toBeNull()
    expect(MockUseCacheUtils.getAllCacheValues().persist[CHAT_NARROW_WIDTH_CACHE_KEY]).toBe(920)
  })

  it('flips live width badge inward when dragged near the stage edge', () => {
    const { container } = render(<Harness stageWidth={1000} />)
    const rightHandle = container.querySelector<HTMLElement>('[data-chat-narrow-resize-handle="right"]')!

    fireEvent.mouseDown(rightHandle, { clientX: 900, clientY: 320 })
    const badge = container.querySelector<HTMLElement>('[data-chat-narrow-width-badge]')!
    expect(badge.className).toContain('left-full')

    fireEvent(document, new MouseEvent('mousemove', { clientX: 960, clientY: 320 }))
    expect(badge.className).toContain('right-full')

    fireEvent(document, new MouseEvent('mouseup'))
  })

  it('starts from the effective stage-clamped width when stored width exceeds stage width', () => {
    MockUseCacheUtils.setPersistCacheValue(CHAT_NARROW_WIDTH_CACHE_KEY, 1200)
    const stageWidth = 900 + CHAT_NARROW_SIDE_PADDING_TOTAL
    const { container } = render(<Harness stageWidth={stageWidth} />)
    const rightHandle = container.querySelector<HTMLElement>('[data-chat-narrow-resize-handle="right"]')!

    fireEvent.mouseDown(rightHandle, { clientX: 800 })
    fireEvent(document, new MouseEvent('mousemove', { clientX: 750 }))
    expect(document.documentElement.style.getPropertyValue(CHAT_NARROW_WIDTH_CSS_VAR)).toBe('800px')

    fireEvent(document, new MouseEvent('mouseup'))
    expect(MockUseCacheUtils.getAllCacheValues().persist[CHAT_NARROW_WIDTH_CACHE_KEY]).toBe(800)
  })

  it('resets width to default on double-click', () => {
    MockUseCacheUtils.setPersistCacheValue(CHAT_NARROW_WIDTH_CACHE_KEY, 1020)
    const { container } = render(<Harness stageWidth={1400} />)
    const leftHandle = container.querySelector<HTMLElement>('[data-chat-narrow-resize-handle="left"]')!

    expect(document.documentElement.style.getPropertyValue(CHAT_NARROW_WIDTH_CSS_VAR)).toBe('1020px')
    fireEvent.doubleClick(leftHandle)

    expect(MockUseCacheUtils.getAllCacheValues().persist[CHAT_NARROW_WIDTH_CACHE_KEY]).toBe(CHAT_NARROW_DEFAULT_WIDTH)
    expect(document.documentElement.style.getPropertyValue(CHAT_NARROW_WIDTH_CSS_VAR)).toBe('800px')
  })

  it('supports keyboard adjustment with inverted arrows on the left handle', () => {
    const { container } = render(<Harness stageWidth={1400} />)
    const leftHandle = container.querySelector<HTMLElement>('[data-chat-narrow-resize-handle="left"]')!
    const rightHandle = container.querySelector<HTMLElement>('[data-chat-narrow-resize-handle="right"]')!

    fireEvent.keyDown(leftHandle, { key: 'ArrowLeft' })
    expect(MockUseCacheUtils.getAllCacheValues().persist[CHAT_NARROW_WIDTH_CACHE_KEY]).toBe(816)

    fireEvent.keyDown(rightHandle, { key: 'ArrowRight' })
    expect(MockUseCacheUtils.getAllCacheValues().persist[CHAT_NARROW_WIDTH_CACHE_KEY]).toBe(832)

    fireEvent.keyDown(rightHandle, { key: 'Home' })
    expect(MockUseCacheUtils.getAllCacheValues().persist[CHAT_NARROW_WIDTH_CACHE_KEY]).toBe(CHAT_NARROW_MIN_WIDTH)

    fireEvent.keyDown(rightHandle, { key: 'End' })
    expect(MockUseCacheUtils.getAllCacheValues().persist[CHAT_NARROW_WIDTH_CACHE_KEY]).toBe(
      1400 - CHAT_NARROW_SIDE_PADDING_TOTAL
    )
  })

  it('hides handles when narrow mode is off, wide layout is forced, invisible, or stage is too narrow', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.narrow_mode', false)
    const { container, rerender, unmount } = render(<Harness stageWidth={1400} />)
    expect(container.querySelector('[data-chat-narrow-resize-overlay]')).toBeNull()

    MockUsePreferenceUtils.setPreferenceValue('chat.narrow_mode', true)
    rerender(<Harness stageWidth={1400} visible={false} />)
    expect(container.querySelector('[data-chat-narrow-resize-overlay]')).toBeNull()

    rerender(<Harness stageWidth={1400} forceWideLayout />)
    expect(container.querySelector('[data-chat-narrow-resize-overlay]')).toBeNull()
    unmount()

    let observerCallback: ResizeObserverCallback | null = null
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        observerCallback = callback
      }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }

    const narrowRender = render(<Harness stageWidth={640} />)
    act(() => {
      observerCallback?.([{ contentRect: { width: 640 } } as ResizeObserverEntry], {} as ResizeObserver)
    })
    expect(narrowRender.container.querySelector('[data-chat-narrow-resize-overlay]')).toBeNull()
  })
})
