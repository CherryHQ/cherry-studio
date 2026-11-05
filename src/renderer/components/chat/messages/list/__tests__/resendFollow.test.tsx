import { act, render } from '@testing-library/react'
import { type Ref } from 'react'
import type { VListHandle } from 'virtua'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatWriteActions } from '@renderer/pages/home/hooks/useChatWriteActions'
import type { Topic } from '@renderer/types/topic'
import type { CherryUIMessage } from '@shared/data/types/message'

import {
  type ChatVirtualizerRuntime,
  type MessageVirtualListHandle,
  useChatVirtualizerRuntime
} from '../chatVirtualizerRuntime'

const { streamOpen } = vi.hoisted(() => ({ streamOpen: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (_route: string, input: unknown) => streamOpen(input) }
}))
vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistant: { settings: {} } })
}))

type WriteParams = Parameters<typeof useChatWriteActions>[0]
type WriteActions = ReturnType<typeof useChatWriteActions>['actions']
type ResendHandler = 'resend' | 'forkAndResend'

const items = ['u1']
const getStringItemKey = (item: string) => item
const uiMessages: CherryUIMessage[] = [
  {
    id: 'u1',
    role: 'user',
    parts: [{ type: 'text', text: 'question' }],
    metadata: { parentId: 'vroot', status: 'success' }
  }
]

function ResendRuntimeProbe({
  writeParams,
  handleRef,
  onReady
}: {
  writeParams: Omit<WriteParams, 'scrollToBottom'>
  handleRef: Ref<MessageVirtualListHandle>
  onReady(runtime: ChatVirtualizerRuntime<string>, actions: WriteActions): void
}) {
  const runtime = useChatVirtualizerRuntime({
    items,
    getItemKey: getStringItemKey,
    renderItem: (item) => <span>{item}</span>,
    hasMoreTop: false,
    handleRef,
    topReachOverscanItems: 4,
    bottomPadding: 12
  })
  const { actions } = useChatWriteActions({ ...writeParams, scrollToBottom: runtime.scrollToBottom })
  onReady(runtime, actions)
  return (
    <div
      ref={(element) => {
        runtime.scrollerRef.current = element
      }}>
      <div ref={runtime.contentRef}>question</div>
      <div ref={runtime.freezeSpacerRef} />
    </div>
  )
}

// Geometry and scheduling helpers match chatVirtualizerRuntime.test.tsx.
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

  globalThis.ResizeObserver = ResizeObserverMock
  return () => {
    globalThis.ResizeObserver = originalResizeObserver
  }
}

function installQueuedAnimationFrame(): { restore(): void; tick(frames?: number): void } {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  let rafId = 0
  let rafQueue = new Map<number, () => void>()

  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const id = ++rafId
    rafQueue.set(id, () => callback(0))
    return id
  }
  globalThis.cancelAnimationFrame = (id: number) => {
    rafQueue.delete(id)
  }

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

function createReadingFixture(handler: ResendHandler) {
  const H = 1600 // Natural content height before a disclosure shrinks it.
  const V = 400 // Viewport height.
  const T = 900 // Reader's scroll offset.
  const F = 200 // Freeze spacer needed after the disclosure shrinks.
  const callbacks: ResizeObserverCallback[] = []
  const restoreResizeObserver = installResizeObserverMock(callbacks)
  const raf = installQueuedAnimationFrame()
  let runtime!: ChatVirtualizerRuntime<string>
  let actions!: WriteActions
  let handle: MessageVirtualListHandle | null = null
  let scrollTop = 0
  let naturalScrollHeight = H
  const seedReservedMessages = vi.fn<WriteParams['seedReservedMessages']>(async () => {})
  const cache = {
    branchWithoutIds: vi.fn((prev: unknown) => prev),
    seedOptimisticBranch: vi.fn(async () => {}),
    seedReservedMessages: vi.fn(async () => {}),
    patchMessageInBranch: vi.fn(),
    rollbackBranch: vi.fn(async () => {}),
    deleteMessageTrigger: vi.fn(async () => ({ deletedIds: [] })),
    deleteMessageGroupTrigger: vi.fn(async () => ({ deletedIds: [] })),
    patchMessageTrigger: vi.fn(async () => {}),
    createSiblingTrigger: vi.fn(async () => ({
      id: 'forked-user',
      parentId: 'vroot',
      siblingsGroupId: 1,
      status: 'success',
      createdAt: '2026-01-01T00:00:00.000Z'
    })),
    createMessageTrigger: vi.fn(async () => ({})),
    setActiveNodeTrigger: vi.fn(async () => ({}))
  } as unknown as WriteParams['cache']
  const view = render(
    <ResendRuntimeProbe
      writeParams={{
        topic: { id: 't1' } as Topic,
        uiMessages,
        activeNodeId: 'u1',
        regenerate: vi.fn(async () => {}),
        setMessages: vi.fn(),
        stop: vi.fn(async () => {}),
        refresh: vi.fn(async () => uiMessages),
        cache,
        seedReservedMessages,
        startNewContextBlocked: false
      }}
      handleRef={(nextHandle) => {
        handle = nextHandle
      }}
      onReady={(nextRuntime, nextActions) => {
        runtime = nextRuntime
        actions = nextActions
      }}
    />
  )
  const scroller = runtime.scrollerRef.current!
  const freezeHeight = () => Number.parseFloat(runtime.freezeSpacerRef.current?.style.height || '0')
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value) => {
      scrollTop = value
    }
  })
  setElementMetric(scroller, 'clientHeight', () => V)
  setElementMetric(scroller, 'scrollHeight', () => naturalScrollHeight + freezeHeight())
  runtime.vlistHandleRef.current = createHandle()
  raf.tick(60)
  act(() => runtime.scrollToBottom())

  const wheelUpTo = (offset: number) => {
    act(() => {
      runtime.scrollerProps.onWheel(new WheelEvent('wheel', { deltaY: offset - scrollTop }))
      scrollTop = offset
      runtime.scrollerProps.onScroll(offset)
      runtime.scrollerProps.onScrollEnd()
    })
  }
  const resize = () => {
    act(() => callbacks.at(-1)!([], {} as ResizeObserver))
    raf.tick(60)
  }
  wheelUpTo(T)
  act(() => runtime.takeUserControl('disclosure'))
  naturalScrollHeight = H - F
  resize()

  return {
    H,
    V,
    T,
    F,
    scroller,
    freezeHeight,
    seedReservedMessages,
    isFollowing: () => handle!.isFollowing(),
    bottomGap: () => Math.max(0, scroller.scrollHeight - scroller.clientHeight) - scroller.scrollTop,
    invoke: () =>
      handler === 'resend' ? actions.resend('u1') : actions.forkAndResend('u1', [{ type: 'text', text: 'edited' }]),
    grow: (height: number) => {
      naturalScrollHeight += height
      resize()
    },
    wheelUpTo,
    dispose: () => {
      view.unmount()
      restoreResizeObserver()
      raf.restore()
    }
  }
}

function expectReading(fixture: ReturnType<typeof createReadingFixture>) {
  const { H, V, T, F, scroller } = fixture
  expect(H - F).toBeGreaterThan(T + V)
  expect(scroller.scrollHeight).toBe(H)
  expect(scroller.clientHeight).toBe(V)
  expect(scroller.scrollTop).toBe(T)
  expect(fixture.freezeHeight()).toBe(F)
  expect(fixture.bottomGap()).toBe(H - V - T)
  expect(fixture.bottomGap()).toBeGreaterThan(0)
  expect(fixture.isFollowing()).toBe(false)
}

describe.each([
  { handler: 'resend', firstSeeds: 0 },
  { handler: 'forkAndResend', firstSeeds: 1 }
] as const)('$handler connects acceptance to viewport following', ({ handler, firstSeeds }) => {
  beforeEach(() => {
    streamOpen.mockReset()
  })

  it.each(['started', 'injected'] as const)(
    'restores follow only after %s acceptance is seeded, follows two growths, then yields to wheel-up',
    async (mode) => {
      const fixture = createReadingFixture(handler)
      try {
        expectReading(fixture)
        streamOpen.mockResolvedValueOnce({ mode, reservedMessages: [] })
        let finishSeed!: () => void
        const finalSeed = new Promise<void>((resolve) => {
          finishSeed = resolve
        })
        if (firstSeeds) fixture.seedReservedMessages.mockResolvedValueOnce()
        fixture.seedReservedMessages.mockImplementationOnce(() => finalSeed)
        const request = fixture.invoke()
        await act(async () => {
          await vi.waitFor(() => expect(fixture.seedReservedMessages).toHaveBeenCalledTimes(firstSeeds + 1))
        })
        expectReading(fixture)

        await act(async () => {
          finishSeed()
          await request
        })
        expect(fixture.isFollowing()).toBe(true)
        expect(fixture.freezeHeight()).toBe(0)
        expect(fixture.scroller.scrollHeight).toBe(fixture.H - fixture.F)
        expect(Math.abs(fixture.bottomGap())).toBeLessThanOrEqual(2)
        expect(fixture.scroller.scrollTop).toBeGreaterThan(fixture.T)

        for (const growth of [fixture.V / 2, fixture.V]) {
          const previousTop = fixture.scroller.scrollTop
          fixture.grow(growth)
          expect(fixture.isFollowing()).toBe(true)
          expect(Math.abs(fixture.bottomGap())).toBeLessThanOrEqual(2)
          expect(fixture.scroller.scrollTop).toBeGreaterThan(previousTop)
        }

        const readingTop = fixture.scroller.scrollTop - fixture.V / 2
        fixture.wheelUpTo(readingTop)
        expect(fixture.isFollowing()).toBe(false)
        expect(fixture.bottomGap()).toBeGreaterThan(0)
        const readingGap = fixture.bottomGap()
        fixture.grow(fixture.V)
        expect(fixture.scroller.scrollTop).toBe(readingTop)
        expect(fixture.bottomGap()).toBe(readingGap + fixture.V)
        expect(fixture.isFollowing()).toBe(false)
      } finally {
        fixture.dispose()
      }
    }
  )

  it('leaves reading geometry intact when open is blocked', async () => {
    const fixture = createReadingFixture(handler)
    try {
      expectReading(fixture)
      streamOpen.mockResolvedValueOnce({ mode: 'blocked', message: 'blocked' })

      await act(async () => {
        await expect(fixture.invoke()).rejects.toThrow('blocked')
      })

      expect(fixture.seedReservedMessages).toHaveBeenCalledTimes(firstSeeds)
      expectReading(fixture)
    } finally {
      fixture.dispose()
    }
  })

  it('leaves reading geometry intact when the accepted final seed rejects', async () => {
    const fixture = createReadingFixture(handler)
    try {
      expectReading(fixture)
      const error = new Error('seed failed')
      streamOpen.mockResolvedValueOnce({ mode: 'started', reservedMessages: [] })
      if (firstSeeds) fixture.seedReservedMessages.mockResolvedValueOnce()
      fixture.seedReservedMessages.mockRejectedValueOnce(error)

      await act(async () => {
        await expect(fixture.invoke()).rejects.toBe(error)
      })

      expect(fixture.seedReservedMessages).toHaveBeenCalledTimes(firstSeeds + 1)
      expectReading(fixture)
    } finally {
      fixture.dispose()
    }
  })
})
