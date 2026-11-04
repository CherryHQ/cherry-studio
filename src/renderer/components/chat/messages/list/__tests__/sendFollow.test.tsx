import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import type { VListHandle } from 'virtua'
import { expect, it, vi } from 'vitest'

import { useChatVirtualizerRuntime } from '@renderer/components/chat/messages/list/chatVirtualizerRuntime'
import type { ExecutionFinishEvent } from '@renderer/hooks/useExecutionOverlay'
import { useAgentChatRuntimeState } from '@renderer/pages/agents/useAgentChatRuntimeState'
import { useChatRuntimeState } from '@renderer/pages/home/useChatRuntimeState'
import type { Topic } from '@renderer/types/topic'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
const mocks = vi.hoisted(() => ({
  turnControllerConfig: null as any,
  onBranchLiveStateChange: vi.fn(),
  refresh: vi.fn(async () => [] as CherryUIMessage[]),
  seedMessagesCache: vi.fn(async () => undefined),
  rollbackBranch: vi.fn(),
  activeExecutions: [] as ActiveExecution[],
  overlayExecutions: [] as ActiveExecution[],
  liveMessageIds: [] as string[],
  liveAssistants: [] as CherryUIMessage[],
  overlayOnUpdate: null as
    | ((executionId: string, event: Pick<ExecutionFinishEvent, 'attemptId' | 'message'>) => void)
    | null,
  autoReadUpdate: vi.fn(),
  overlayOnFinish: null as ((executionId: string, event: ExecutionFinishEvent) => void) | null,
  sendTurn: vi.fn(),
  autoReadConsume: vi.fn(async () => ({ status: 'started' })),
  autoReadEnabled: true
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => vi.fn()
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [mocks.autoReadEnabled, vi.fn()]
}))

vi.mock('@renderer/services/voice', () => ({
  autoReadService: {
    update: mocks.autoReadUpdate,
    consume: mocks.autoReadConsume
  }
}))

// The live-state builder is the guard's observable output surface: the test
// asserts on the topic/message ids it forwards to onBranchLiveStateChange.
vi.mock('@renderer/components/chat/flow/topicMessageFlowLiveTree', () => ({
  buildTopicMessageFlowLiveState: ({
    topicId,
    messages,
    activeNodeId
  }: {
    topicId: string
    messages: CherryUIMessage[]
    activeNodeId: string | null
  }) => ({
    topicId,
    activeNodeId,
    messageIds: messages.map((message) => message.id),
    messages
  })
}))

vi.mock('@renderer/components/chat/messages/stream/useMessageStreamingLayers', () => ({
  createOverlayRefreshHandoff: () => vi.fn(),
  useMessageStreamingLayers: () => ({
    partsByMessageId: {},
    liveMessageIds: mocks.liveMessageIds,
    streamingLayers: { liveMessageIds: mocks.liveMessageIds }
  })
}))

vi.mock('@renderer/components/chat/messages/utils/dispatchLocateMessage', () => ({
  dispatchLocateMessage: vi.fn()
}))

vi.mock('@renderer/components/composer/useToolApprovalComposerOverrides', () => ({
  useToolApprovalComposerOverrides: () => []
}))

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: () => ({
    regenerate: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn(),
    activeExecutions: mocks.activeExecutions
  })
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: (
    _topicId: string,
    executions: ActiveExecution[],
    options?: {
      onUpdate?: (executionId: string, event: Pick<ExecutionFinishEvent, 'attemptId' | 'message'>) => void
      onFinish?: (executionId: string, event: ExecutionFinishEvent) => void
    }
  ) => {
    mocks.overlayExecutions = executions
    mocks.overlayOnUpdate = options?.onUpdate ?? null
    mocks.overlayOnFinish = options?.onFinish ?? null
    return {
      overlay: {},
      liveAssistants: mocks.liveAssistants,
      disposeOverlay: vi.fn(),
      reset: vi.fn()
    }
  }
}))

vi.mock('@renderer/hooks/useToolApprovalBridge', () => ({
  useToolApprovalBridge: () => vi.fn()
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false }),
  useTopicAwaitingApproval: () => false,
  useTopicOverlayHandoffOnTerminal: vi.fn()
}))

vi.mock('@renderer/pages/home/hooks/useChatWriteActions', () => ({
  useChatWriteActions: () => ({ actions: {} })
}))

vi.mock('@renderer/pages/home/hooks/useTopicMessagesCache', () => ({
  useTopicMessagesCache: () => ({
    seedReservedMessages: mocks.seedMessagesCache,
    rollbackBranch: mocks.rollbackBranch
  })
}))

vi.mock('@renderer/hooks/useConversationErrorToasts', () => ({
  useConversationErrorToasts: () => ({ track: vi.fn(), report: vi.fn(), onFinish: vi.fn() })
}))

const transport = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route, input) => {
      if (route !== 'ai.stream.open') throw new Error(route)
      return transport.open(input)
    }
  }
}))
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

vi.mock('@renderer/hooks/agent/useAgentSessionSlashCommands', () => ({ useAgentSessionSlashCommands: () => [] }))
vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: () => ({
    messages,
    persistedPartsByMessageId: {},
    isLoading: false,
    hasOlder: false,
    refresh: mocks.refresh,
    seedReservedMessages: mocks.seedMessagesCache
  })
}))
const messages = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'question' }], metadata: { status: 'success' } }
]
let agent, runtime, handle
const topic: Topic = {
  id: 'probe-topic',
  assistantId: 'assistant-1',
  name: 'Topic',
  messages: [],
  lastActivityAt: '',
  createdAt: '',
  updatedAt: ''
}
function HomeHost() {
  const home = useChatRuntimeState({
    topic,
    isHistoryLoading: false,
    initialMessages: messages as CherryUIMessage[],
    uiMessages: messages as CherryUIMessage[],
    refresh: mocks.refresh,
    activeNodeId: null,
    messagesCacheMutate: vi.fn(),
    onBranchLiveStateChange: mocks.onBranchLiveStateChange
  })
  agent = home
  return <Viewport bindRuntime={home.bindMessageListRuntime} items={messages as CherryUIMessage[]} />
}
function Host() {
  agent = useAgentChatRuntimeState({ sessionId: 'probe-session', sessionMessagesEnabled: true, reservedMessages: [] })
  return <Viewport bindRuntime={agent.bindMessageListRuntime} items={agent.uiMessages} />
}
function Viewport({
  bindRuntime,
  items
}: {
  bindRuntime: typeof agent.bindMessageListRuntime
  items: CherryUIMessage[]
}) {
  runtime = useChatVirtualizerRuntime({
    items,
    getItemKey: (m: CherryUIMessage) => m.id,
    renderItem: (m: CherryUIMessage) => <span>{m.id}</span>,
    hasMoreTop: false,
    handleRef: (h) => {
      handle = h
    },
    topReachOverscanItems: 4,
    bottomPadding: 12,
    topicId: 'agent-session:probe-session'
  })
  useEffect(
    () =>
      bindRuntime?.({
        scrollToBottom: runtime.scrollToBottom,
        locateMessage: vi.fn(),
        copyTopicImage: vi.fn(),
        exportTopicImage: vi.fn()
      }),
    [bindRuntime]
  )
  return (
    <div
      ref={(el) => {
        runtime.scrollerRef.current = el
      }}>
      <div ref={runtime.contentRef}>question</div>
      <div ref={runtime.freezeSpacerRef} />
    </div>
  )
}
it.each([
  { kind: 'agent', mode: 'started', withFreeze: true },
  { kind: 'agent', mode: 'injected', withFreeze: true },
  { kind: 'agent', mode: 'started', withFreeze: false },
  { kind: 'home', mode: 'started', withFreeze: true },
  { kind: 'home', mode: 'injected', withFreeze: true },
  { kind: 'home', mode: 'started', withFreeze: false }
])('$kind $mode accepted send, freeze=$withFreeze', async ({ kind, mode, withFreeze }) => {
  MockCacheUtils.resetMocks()
  mocks.seedMessagesCache.mockClear()
  transport.open.mockClear()

  const callbacks: ResizeObserverCallback[] = [],
    restoreRO = installResizeObserverMock(callbacks),
    raf = installQueuedAnimationFrame()
  const view = render(kind === 'home' ? <HomeHost /> : <Host />),
    scroller = runtime.scrollerRef.current
  let top = 0,
    natural = 1600
  const freeze = () => parseFloat(runtime.freezeSpacerRef.current?.style.height || '0')
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v) => {
      top = v
    }
  })
  setElementMetric(scroller, 'clientHeight', () => 400)
  setElementMetric(scroller, 'scrollHeight', () => natural + freeze())
  runtime.vlistHandleRef.current = createHandle()
  const resize = () => {
    act(() => callbacks.at(-1)!([], {} as ResizeObserver))
    raf.tick(60)
  }
  const read = (label) => ({
    label,
    mode,
    withFreeze,
    following: handle.isFollowing(),
    scrollTop: top,
    scrollHeight: scroller.scrollHeight,
    clientHeight: 400,
    bottomGap: scroller.scrollHeight - 400 - top,
    freezeSpacer: freeze()
  })
  try {
    raf.tick(60)
    act(() => {
      runtime.scrollToBottom()
    })
    act(() => {
      runtime.scrollerProps.onWheel(new WheelEvent('wheel', { deltaY: -300 }))
      top = 900
      runtime.scrollerProps.onScroll()
      runtime.scrollerProps.onScrollEnd()
      if (withFreeze) runtime.takeUserControl('disclosure')
    })
    if (withFreeze) natural = 1400
    resize()
    const before = read('before')
    expect(before.following).toBe(false)
    expect(before.freezeSpacer).toBe(withFreeze ? 200 : 0)
    let release
    const seed = new Promise<undefined>((r) => {
      release = r
    })
    mocks.seedMessagesCache.mockImplementationOnce(() => seed)
    let finishOpen
    transport.open.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOpen = resolve
        })
    )
    let pending
    await act(async () => {
      pending = agent.sendMessage({ text: 'send' })
      await vi.waitFor(() => expect(transport.open).toHaveBeenCalled())
    })
    raf.tick(60)
    expect(read('before')).toEqual(before)
    await act(async () => {
      finishOpen({
        mode,
        reservedMessages: [{ id: 'new-user', role: 'user', parts: [{ type: 'text', text: 'send' }] }]
      })
      await vi.waitFor(() => expect(mocks.seedMessagesCache).toHaveBeenCalledOnce())
    })
    raf.tick(60)
    expect(read('before')).toEqual(before)
    await act(async () => {
      release(undefined)
      expect(await pending).toBe(true)
    })
    raf.tick(60)
    const acceptance = read('accepted-after-60-frames')
    expect(acceptance.following).toBe(true)
    expect(acceptance.freezeSpacer).toBe(0)
    expect(Math.abs(acceptance.bottomGap)).toBeLessThanOrEqual(2)
    let previousTop = acceptance.scrollTop
    for (const growth of [200, 400]) {
      natural += growth
      resize()
      const current = read('growth')
      expect(current.following).toBe(true)
      expect(current.freezeSpacer).toBe(0)
      expect(Math.abs(current.bottomGap)).toBeLessThanOrEqual(2)
      expect(current.scrollTop).toBeGreaterThan(previousTop)
      previousTop = current.scrollTop
    }
    act(() => {
      runtime.scrollerProps.onWheel(new WheelEvent('wheel', { deltaY: -100 }))
      top -= 100
      runtime.scrollerProps.onScroll()
      runtime.scrollerProps.onScrollEnd()
    })
    const reading = read('reading')
    natural += 200
    resize()
    const afterGrowth = read('reading')
    expect(afterGrowth.following).toBe(false)
    expect(afterGrowth.scrollTop).toBe(reading.scrollTop)
    expect(afterGrowth.bottomGap).toBe(reading.bottomGap + 200)
  } finally {
    view.unmount()
    restoreRO()
    raf.restore()
  }
})

function readingFixture(kind: 'home' | 'agent', following = false) {
  MockCacheUtils.resetMocks()
  mocks.seedMessagesCache.mockReset().mockResolvedValue(undefined)
  mocks.rollbackBranch.mockClear()
  mocks.refresh.mockClear()
  transport.open.mockReset()
  const callbacks: ResizeObserverCallback[] = []
  const restoreRO = installResizeObserverMock(callbacks)
  const raf = installQueuedAnimationFrame()
  const view = render(kind === 'home' ? <HomeHost /> : <Host />)
  const scroller = runtime.scrollerRef.current as HTMLElement
  let top = 0
  let natural = 1600
  const freeze = () => parseFloat(runtime.freezeSpacerRef.current?.style.height || '0')
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (value) => (top = value) })
  setElementMetric(scroller, 'clientHeight', () => 400)
  setElementMetric(scroller, 'scrollHeight', () => natural + freeze())
  runtime.vlistHandleRef.current = createHandle()
  const resize = () => {
    act(() => callbacks.at(-1)!([], {} as ResizeObserver))
    raf.tick(60)
  }
  raf.tick(60)
  act(() => {
    runtime.scrollToBottom()
  })
  if (!following) {
    act(() => {
      runtime.scrollerProps.onWheel(new WheelEvent('wheel', { deltaY: -300 }))
      top = 900
      runtime.scrollerProps.onScroll()
      runtime.scrollerProps.onScrollEnd()
      runtime.takeUserControl('disclosure')
    })
    natural = 1400
    resize()
  }
  return {
    raf,
    read: () => ({
      H: scroller.scrollHeight,
      V: scroller.clientHeight,
      T: top,
      F: freeze(),
      gap: scroller.scrollHeight - 400 - top,
      following: handle.isFollowing()
    }),
    grow: (amount: number) => {
      natural += amount
      resize()
    },
    dispose: () => {
      view.unmount()
      restoreRO()
      raf.restore()
    }
  }
}

it.each(['home', 'agent'] as const)('%s leaves reading intact on blocked and rejected sends', async (kind) => {
  for (const failure of ['blocked', 'seed'] as const) {
    const fixture = readingFixture(kind)
    try {
      const before = fixture.read()
      if (failure === 'blocked') transport.open.mockResolvedValueOnce({ mode: 'blocked', message: 'blocked' })
      else {
        transport.open.mockResolvedValueOnce({
          mode: 'started',
          reservedMessages: [{ id: 'new-user', role: 'user', parts: [] }]
        })
        mocks.seedMessagesCache.mockRejectedValueOnce(new Error('seed failed'))
      }
      await act(async () => {
        expect(await agent.sendMessage({ text: 'send' })).toBe(false)
      })
      fixture.raf.tick(60)
      expect(fixture.read()).toEqual(before)
      if (failure === 'blocked') expect(mocks.seedMessagesCache).not.toHaveBeenCalled()
      else expect(kind === 'home' ? mocks.rollbackBranch : mocks.refresh).toHaveBeenCalled()
    } finally {
      fixture.dispose()
    }
  }
})

it.each(['home', 'agent'] as const)('%s follows accepted sends without reservations', async (kind) => {
  for (const mode of ['started', 'injected']) {
    for (const reservations of ['empty', 'omitted']) {
      const fixture = readingFixture(kind)
      try {
        transport.open.mockResolvedValueOnce(reservations === 'empty' ? { mode, reservedMessages: [] } : { mode })
        await act(async () => {
          expect(await agent.sendMessage({ text: 'send' })).toBe(true)
        })
        fixture.raf.tick(60)
        expect(mocks.seedMessagesCache).not.toHaveBeenCalled()
        expect(fixture.read().following).toBe(true)
        expect(fixture.read().F).toBe(0)
        expect(Math.abs(fixture.read().gap)).toBeLessThanOrEqual(2)
      } finally {
        fixture.dispose()
      }
    }
  }
})

it.each(['home', 'agent'] as const)('%s remains following after send and growth', async (kind) => {
  const fixture = readingFixture(kind, true)
  try {
    transport.open.mockResolvedValueOnce({ mode: 'started' })
    await act(async () => {
      expect(await agent.sendMessage({ text: 'send' })).toBe(true)
    })
    fixture.raf.tick(60)
    const before = fixture.read()
    fixture.grow(200)
    const after = fixture.read()
    expect(after.following).toBe(true)
    expect(Math.abs(after.gap)).toBeLessThanOrEqual(2)
    expect(after.T).toBeGreaterThan(before.T)
  } finally {
    fixture.dispose()
  }
})

function BindingHost({ sessionId }: { sessionId: string }) {
  agent = useAgentChatRuntimeState({ sessionId, sessionMessagesEnabled: true, reservedMessages: [] })
  return null
}

function binding(commands: string[], session: string) {
  return {
    scrollToBottom: () => commands.push(session),
    locateMessage: vi.fn(),
    copyTopicImage: vi.fn(),
    exportTopicImage: vi.fn()
  }
}

it.each(['open', 'seed', 'frame'] as const)(
  'does not scroll either session after switching during %s',
  async (stage) => {
    MockCacheUtils.resetMocks()
    mocks.seedMessagesCache.mockReset().mockResolvedValue(undefined)
    transport.open.mockReset()
    const raf = installQueuedAnimationFrame()
    const view = render(<BindingHost sessionId="old" />)
    const commands: string[] = []
    try {
      const unbind = agent.bindMessageListRuntime(binding(commands, 'old'))
      const open = Promise.withResolvers<unknown>()
      const seed = Promise.withResolvers<undefined>()
      transport.open.mockReturnValueOnce(open.promise)
      if (stage === 'seed') mocks.seedMessagesCache.mockReturnValueOnce(seed.promise)
      let pending: Promise<boolean>
      await act(async () => {
        pending = agent.sendMessage({ text: 'send' })
        await vi.waitFor(() => expect(transport.open).toHaveBeenCalled())
      })
      if (stage !== 'open') {
        await act(async () => {
          open.resolve({
            mode: 'started',
            reservedMessages: stage === 'seed' ? [{ id: 'new', role: 'user', parts: [] }] : []
          })
          if (stage === 'seed') await vi.waitFor(() => expect(mocks.seedMessagesCache).toHaveBeenCalled())
          else expect(await pending).toBe(true)
        })
      }
      view.rerender(<BindingHost sessionId="replacement" />)
      unbind()
      agent.bindMessageListRuntime(binding(commands, 'replacement'))
      await act(async () => {
        if (stage === 'open') open.resolve({ mode: 'started' })
        if (stage === 'seed') seed.resolve(undefined)
        await pending
      })
      raf.tick(60)
      expect(commands).toEqual([])
    } finally {
      view.unmount()
      raf.restore()
    }
  }
)

it('keeps replacement bindings and never replays a send after unbinding', async () => {
  MockCacheUtils.resetMocks()
  transport.open.mockReset().mockResolvedValue({ mode: 'started' })
  const raf = installQueuedAnimationFrame()
  const view = render(<BindingHost sessionId="session" />)
  const commands: string[] = []
  try {
    const oldCleanup = agent.bindMessageListRuntime(binding(commands, 'old'))
    const newCleanup = agent.bindMessageListRuntime(binding(commands, 'new'))
    oldCleanup()
    await act(async () => {
      expect(await agent.sendMessage({ text: 'send' })).toBe(true)
    })
    raf.tick(60)
    expect(commands).toEqual(['new'])
    newCleanup()
    await act(async () => {
      expect(await agent.sendMessage({ text: 'send' })).toBe(true)
    })
    agent.bindMessageListRuntime(binding(commands, 'later'))
    raf.tick(60)
    expect(commands).toEqual(['new'])
  } finally {
    view.unmount()
    raf.restore()
  }
})
