import { BaseService } from '@main/core/lifecycle'
import { type WindowInfo, WindowType } from '@main/core/window/types'
import type { TopicStatusSnapshotEntry, TopicStreamStatus } from '@shared/ai/transport'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type CacheListener = (
  value: TopicStatusSnapshotEntry | null | undefined,
  oldValue: TopicStatusSnapshotEntry | null | undefined,
  concreteKey: string
) => void

const mocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const screenListeners = new Map<string, Set<Listener>>()
  const onScreen = (event: string, listener: Listener) => {
    if (!screenListeners.has(event)) screenListeners.set(event, new Set())
    screenListeners.get(event)?.add(listener)
  }
  const offScreen = (event: string, listener: Listener) => screenListeners.get(event)?.delete(listener)

  return {
    activitiesListener: undefined as ((event: any) => void) | undefined,
    cacheDisposers: new Map<string, ReturnType<typeof vi.fn>>(),
    cacheSubscriptions: new Map<string, CacheListener>(),
    createdListeners: [] as Array<(managed: any) => void>,
    destroyedListeners: [] as Array<(managed: any) => void>,
    displays: [] as any[],
    focusedWindowInfos: [] as WindowInfo[],
    geometryProbe: vi.fn(),
    geometryResolve: vi.fn(),
    geometrySize: vi.fn(),
    i18nSuffix: '',
    loggerError: vi.fn(),
    loggerWarn: vi.fn(),
    name: 'Research notes',
    openError: undefined as Error | undefined,
    powerListener: undefined as (() => void) | undefined,
    preferenceListeners: new Map<string, (value: any) => void>(),
    preferences: new Map<string, any>(),
    prefersReducedMotion: false,
    resolveName: vi.fn(),
    screenListeners,
    screen: {
      on: vi.fn(onScreen),
      removeListener: vi.fn(offScreen),
      emit(event: string, ...args: unknown[]) {
        for (const listener of screenListeners.get(event) ?? []) listener(...args)
      },
      getAllDisplays: vi.fn(() => [] as any[]),
      getPrimaryDisplay: vi.fn(() => undefined as any),
      getDisplayMatching: vi.fn((_bounds: unknown) => undefined as any)
    },
    windows: new Map<string, any>(),
    windowSequence: 0
  }
})

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError, warn: mocks.loggerWarn }) }
}))

vi.mock('@main/i18n', () => ({
  t: (key: string) => {
    const fallback: Record<string, string> = {
      'agent.session.new': 'New task',
      'chat.conversation.new': 'New Chat'
    }
    return `${fallback[key] ?? key}${mocks.i18nSuffix}`
  }
}))

vi.mock('@main/utils/fullChromeWindows', () => ({
  getFullChromeWindowInfos: () => mocks.focusedWindowInfos
}))

vi.mock('../macScreenGeometry', () => ({
  COMPACT_ISLAND_SIZE: { width: 320, height: 38 },
  probeMacScreenGeometry: (...args: unknown[]) => mocks.geometryProbe(...args),
  resolveConversationIslandBounds: (...args: unknown[]) => mocks.geometryResolve(...args),
  resolveConversationIslandSize: (...args: unknown[]) => mocks.geometrySize(...args)
}))

vi.mock('electron', () => ({
  screen: mocks.screen,
  systemPreferences: {
    getAnimationSettings: () => ({
      shouldRenderRichAnimation: true,
      scrollAnimationsEnabledBySystem: true,
      prefersReducedMotion: mocks.prefersReducedMotion
    })
  }
}))

function createWindow(initialBounds = { x: 0, y: 0, width: 320, height: 38 }) {
  let bounds = { ...initialBounds }
  return {
    getBounds: vi.fn(() => bounds),
    hide: vi.fn(),
    isDestroyed: vi.fn(() => false),
    setBounds: vi.fn((nextBounds: typeof bounds) => {
      bounds = { ...nextBounds }
    }),
    showInactive: vi.fn()
  }
}

const services = vi.hoisted(() => {
  const cacheService = {
    subscribeSharedChange: vi.fn((key: string, listener: CacheListener) => {
      const dispose = vi.fn(() => {
        if (mocks.cacheSubscriptions.get(key) === listener) mocks.cacheSubscriptions.delete(key)
      })
      mocks.cacheSubscriptions.set(key, listener)
      mocks.cacheDisposers.set(key, dispose)
      return dispose
    })
  }

  const preferenceService = {
    get: vi.fn((key: string) => mocks.preferences.get(key)),
    subscribeChange: vi.fn((key: string, listener: (value: any) => void) => {
      mocks.preferenceListeners.set(key, listener)
      return () => mocks.preferenceListeners.delete(key)
    })
  }

  const powerService = {
    onResume: vi.fn((listener: () => void) => {
      mocks.powerListener = listener
      return {
        dispose: vi.fn(() => {
          if (mocks.powerListener === listener) mocks.powerListener = undefined
        })
      }
    })
  }

  const windowManager = {
    close: vi.fn((id: string) => {
      const window = mocks.windows.get(id)
      if (!window) return false
      mocks.windows.delete(id)
      for (const listener of mocks.destroyedListeners) listener({ id, type: WindowType.ConversationIsland, window })
      return true
    }),
    getWindow: vi.fn((id: string) => mocks.windows.get(id)),
    onWindowCreatedByType: vi.fn((_type: WindowType, listener: (managed: any) => void) => {
      mocks.createdListeners.push(listener)
      return { dispose: vi.fn(() => mocks.createdListeners.splice(mocks.createdListeners.indexOf(listener), 1)) }
    }),
    onWindowDestroyedByType: vi.fn((_type: WindowType, listener: (managed: any) => void) => {
      mocks.destroyedListeners.push(listener)
      return { dispose: vi.fn(() => mocks.destroyedListeners.splice(mocks.destroyedListeners.indexOf(listener), 1)) }
    }),
    open: vi.fn((type: WindowType, args: unknown) => {
      void args
      if (mocks.openError) {
        const error = mocks.openError
        mocks.openError = undefined
        throw error
      }
      const id = `island-${++mocks.windowSequence}`
      const window = createWindow()
      mocks.windows.set(id, window)
      for (const listener of mocks.createdListeners) listener({ id, type, window })
      return id
    }),
    pushInitData: vi.fn((id: string, _snapshot: unknown) => mocks.windows.has(id))
  }

  return { cacheService, powerService, preferenceService, windowManager }
})

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    getById: (conversationId: string) => ({
      name: mocks.resolveName({ conversationType: 'agent', conversationId })
    })
  }
}))

vi.mock('@data/services/TopicService', () => ({
  topicService: {
    getById: (conversationId: string) => ({
      name: mocks.resolveName({ conversationType: 'assistant', conversationId })
    })
  }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      const service = {
        CacheService: services.cacheService,
        PowerService: services.powerService,
        PreferenceService: services.preferenceService,
        WindowManager: services.windowManager
      }[name]
      if (!service) throw new Error(`Unexpected application.get(${name})`)
      return service
    }
  }
}))

const { ConversationIslandService } = await import('../ConversationIslandService')

const internalDisplay = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, internal: true }
const externalDisplay = { id: 2, bounds: { x: 1512, y: 0, width: 1920, height: 1080 }, internal: false }

function emitActivity(
  status: TopicStreamStatus | null,
  changedAt: number,
  topicId = 'topic-1',
  conversationType: 'assistant' | 'agent' = 'assistant',
  turnId = `${topicId}-turn`
): void {
  vi.setSystemTime(changedAt)
  const pattern =
    conversationType === 'agent'
      ? 'topic.stream.statuses.agent-session:${sessionId}'
      : 'topic.stream.statuses.${topicId}'
  const concreteTopicId = conversationType === 'agent' ? `agent-session:${topicId}` : topicId
  mocks.cacheSubscriptions.get(pattern)?.(
    status === null ? null : { status, turnId, activeExecutions: [], awaitingApprovalAnchors: [] },
    null,
    `topic.stream.statuses.${concreteTopicId}`
  )
}

function changePreference(key: string, value: unknown): void {
  mocks.preferences.set(key, value)
  mocks.preferenceListeners.get(key)?.(value)
}

function latestSnapshot(): any {
  const pushed = services.windowManager.pushInitData.mock.lastCall?.[1]
  if (pushed) return pushed
  return (services.windowManager.open.mock.lastCall?.[1] as { initData?: unknown } | undefined)?.initData
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('ConversationIslandService', () => {
  let service: InstanceType<typeof ConversationIslandService>

  beforeEach(async () => {
    BaseService.resetInstances()
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.clearAllMocks()
    mocks.activitiesListener = undefined
    mocks.cacheDisposers.clear()
    mocks.cacheSubscriptions.clear()
    mocks.createdListeners.length = 0
    mocks.destroyedListeners.length = 0
    mocks.displays = [internalDisplay, externalDisplay]
    mocks.focusedWindowInfos = []
    mocks.geometryProbe.mockResolvedValue(new Map())
    mocks.geometryResolve.mockImplementation(
      (display: any, _geometry: unknown, size: { width: number; height: number }) => ({
        bounds: { x: display.bounds.x, y: display.bounds.y + 8, ...size },
        presentation: 'capsule'
      })
    )
    mocks.geometrySize.mockImplementation((presentation: 'notch' | 'capsule', activityCount: number) => ({
      width: 420,
      height: activityCount * 44 + (presentation === 'notch' ? 46 : 16)
    }))
    mocks.i18nSuffix = ''
    mocks.name = 'Research notes'
    mocks.openError = undefined
    mocks.powerListener = undefined
    mocks.preferenceListeners.clear()
    mocks.preferences.clear()
    mocks.prefersReducedMotion = false
    mocks.preferences.set('feature.conversation_island.enabled', false)
    mocks.preferences.set('app.language', 'en-US')
    mocks.resolveName.mockImplementation(() => mocks.name)
    mocks.screenListeners.clear()
    mocks.screen.getAllDisplays.mockImplementation(() => mocks.displays)
    mocks.screen.getPrimaryDisplay.mockImplementation(() => mocks.displays[0])
    mocks.screen.getDisplayMatching.mockImplementation((value: unknown) => {
      const bounds = value as { x: number }
      return bounds.x >= externalDisplay.bounds.x ? externalDisplay : internalDisplay
    })
    mocks.windows.clear()
    mocks.windows.set('main-1', createWindow({ x: 1600, y: 20, width: 1000, height: 700 }))
    mocks.windowSequence = 0

    service = new ConversationIslandService()
    await service._doInit()
    mocks.activitiesListener = (event) => {
      const pattern =
        event.target.conversationType === 'agent'
          ? 'topic.stream.statuses.agent-session:${sessionId}'
          : 'topic.stream.statuses.${topicId}'
      mocks.cacheSubscriptions.get(pattern)?.(event.snapshot, null, `topic.stream.statuses.${event.topicId}`)
    }
  })

  afterEach(async () => {
    await service._doStop()
    vi.clearAllTimers()
    vi.useRealTimers()
    BaseService.resetInstances()
  })

  it('observes assistant and agent-session activity through their exact cache patterns', () => {
    expect([...mocks.cacheSubscriptions.keys()]).toEqual([
      'topic.stream.statuses.${topicId}',
      'topic.stream.statuses.agent-session:${sessionId}'
    ])
  })

  it('projects assistant and agent-session cache activity to navigation targets', () => {
    mocks.resolveName.mockImplementation(
      (target: { conversationType: 'assistant' | 'agent'; conversationId: string }) =>
        `${target.conversationType}:${target.conversationId}`
    )
    changePreference('feature.conversation_island.enabled', true)

    emitActivity('streaming', 100, 'topic-assistant', 'assistant')
    expect(latestSnapshot()).toMatchObject({
      activityId: 'topic-assistant',
      target: { conversationType: 'assistant', conversationId: 'topic-assistant' },
      title: 'assistant:topic-assistant'
    })

    emitActivity('aborted', 200, 'topic-assistant', 'assistant')
    emitActivity('streaming', 300, 'session-1', 'agent')
    expect(latestSnapshot()).toMatchObject({
      activityId: 'agent-session:session-1',
      target: { conversationType: 'agent', conversationId: 'session-1' },
      title: 'agent:session-1'
    })
  })

  it('retains live activity while disabled without creating resources', async () => {
    mocks.focusedWindowInfos = [
      {
        id: 'main-1',
        type: WindowType.Main,
        title: 'Cherry Studio',
        isVisible: true,
        isFocused: true,
        createdAt: 1
      }
    ]

    emitActivity('pending', 100)

    expect(services.windowManager.open).not.toHaveBeenCalled()
    expect(mocks.geometryProbe).not.toHaveBeenCalled()
    expect(mocks.screenListeners.size).toBe(0)
    expect(mocks.powerListener).toBeUndefined()

    changePreference('feature.conversation_island.enabled', true)
    await flushPromises()

    expect(services.windowManager.open).toHaveBeenCalledOnce()
    expect(mocks.geometryProbe).toHaveBeenCalledOnce()
    expect(mocks.geometryResolve).toHaveBeenCalledWith(externalDisplay, expect.any(Map), { width: 320, height: 38 })
  })

  it('discards terminal activity while disabled or when the feature is disabled', () => {
    emitActivity('done', 100, 'topic-done')
    emitActivity('error', 200, 'topic-error')

    expect(vi.getTimerCount()).toBe(0)

    changePreference('feature.conversation_island.enabled', true)
    expect(services.windowManager.open).not.toHaveBeenCalled()

    emitActivity('done', 300, 'topic-active')
    expect(services.windowManager.open).toHaveBeenCalledOnce()

    changePreference('feature.conversation_island.enabled', false)
    changePreference('feature.conversation_island.enabled', true)

    expect(services.windowManager.open).toHaveBeenCalledOnce()
  })

  it('creates one singleton and pushes later state with a cached title', () => {
    changePreference('feature.conversation_island.enabled', true)

    emitActivity('pending', 100)
    emitActivity('streaming', 200)

    expect(services.windowManager.open).toHaveBeenCalledOnce()
    expect(services.windowManager.pushInitData).toHaveBeenCalledOnce()
    expect(mocks.resolveName).toHaveBeenCalledOnce()
    expect(services.windowManager.pushInitData.mock.calls[0][1]).toMatchObject({
      title: 'Research notes',
      state: 'streaming'
    })
  })

  it('shows live approval anchors as awaiting confirmation', () => {
    changePreference('feature.conversation_island.enabled', true)
    vi.setSystemTime(100)
    const approvalAnchor = {
      executionId: 'provider::model',
      attemptId: 1,
      anchorMessageId: 'assistant-message-1'
    }
    mocks.activitiesListener?.({
      topicId: 'agent-session:session-1',
      target: { conversationType: 'agent', conversationId: 'session-1' },
      snapshot: {
        status: 'streaming',
        turnId: 'turn-1',
        activeExecutions: [approvalAnchor],
        awaitingApprovalAnchors: [approvalAnchor]
      },
      changedAt: 100
    })

    expect(services.windowManager.open.mock.calls[0][1]).toMatchObject({
      initData: {
        state: 'awaiting-confirmation',
        statusText: 'conversation_island.status.awaiting_confirmation'
      }
    })
  })

  it('forwards the measured physical notch width to initial and updated snapshots', () => {
    mocks.geometryResolve.mockReturnValue({
      bounds: { x: 596, y: 0, width: 320, height: 38 },
      presentation: 'notch',
      notchWidth: 184
    })
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100)
    emitActivity('streaming', 200)
    expect(services.windowManager.open.mock.calls[0][1]).toMatchObject({
      initData: { presentation: 'notch', notchWidth: 184 }
    })
    expect(services.windowManager.pushInitData.mock.lastCall?.[1]).toMatchObject({
      presentation: 'notch',
      notchWidth: 184
    })
  })

  it('resolves the title again when the same topic starts a new turn', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100, 'topic-1', 'assistant', 'turn-1')
    emitActivity('aborted', 200, 'topic-1', 'assistant', 'turn-1')

    mocks.name = 'Renamed conversation'
    emitActivity('pending', 300, 'topic-1', 'assistant', 'turn-2')

    expect(mocks.resolveName).toHaveBeenCalledTimes(2)
    expect(services.windowManager.open.mock.lastCall?.[1]).toMatchObject({
      initData: { title: 'Renamed conversation' }
    })
  })

  it('destroys terminal windows at their exact TTL and removes aborted activity immediately', async () => {
    changePreference('feature.conversation_island.enabled', true)

    emitActivity('done', 100)
    await vi.advanceTimersByTimeAsync(3_999)
    expect(services.windowManager.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(services.windowManager.close).toHaveBeenCalledTimes(1)

    emitActivity('error', 5_000, 'topic-error')
    await vi.advanceTimersByTimeAsync(5_999)
    expect(services.windowManager.close).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(services.windowManager.close).toHaveBeenCalledTimes(2)

    emitActivity('pending', 12_000, 'topic-abort')
    emitActivity('aborted', 12_100, 'topic-abort')
    expect(services.windowManager.close).toHaveBeenCalledTimes(3)
  })

  it('always resolves the title and refreshes localized title and status on language change', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('streaming', 100)
    expect(mocks.resolveName).toHaveBeenCalledOnce()
    expect(services.windowManager.open.mock.lastCall?.[1]).toMatchObject({
      initData: {
        title: 'Research notes',
        statusText: 'conversation_island.status.assistant.streaming'
      }
    })

    mocks.name = ''
    mocks.i18nSuffix = '-fr'
    changePreference('app.language', 'fr-FR')

    expect(mocks.resolveName).toHaveBeenCalledTimes(2)
    expect(services.windowManager.pushInitData.mock.lastCall?.[1]).toMatchObject({
      title: 'New Chat-fr',
      statusText: 'conversation_island.status.assistant.streaming-fr'
    })
  })

  it('refuses a single activity and expands two activities with a complete ordered snapshot', () => {
    const titles = new Map([
      ['topic-streaming', 'Streaming research'],
      ['topic-approval', 'Approval request']
    ])
    mocks.resolveName.mockImplementation((target: { conversationId: string }) => titles.get(target.conversationId))
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('streaming', 100, 'topic-streaming')

    ;(service as unknown as { setExpanded(expanded: boolean): void }).setExpanded(true)
    expect(latestSnapshot()).toMatchObject({ activityId: 'topic-streaming', expanded: false, secondaryCount: 0 })
    expect(latestSnapshot().activities).toBeUndefined()

    emitActivity('awaiting-approval', 200, 'topic-approval', 'agent')
    ;(service as unknown as { setExpanded(expanded: boolean): void }).setExpanded(true)

    expect(latestSnapshot()).toMatchObject({
      activityId: 'agent-session:topic-approval',
      state: 'awaiting-confirmation',
      statusText: 'conversation_island.status.awaiting_confirmation',
      title: 'Approval request',
      secondaryCount: 1,
      expanded: true,
      activities: [
        {
          activityId: 'agent-session:topic-approval',
          state: 'awaiting-confirmation',
          statusText: 'conversation_island.status.awaiting_confirmation',
          title: 'Approval request'
        },
        {
          activityId: 'topic-streaming',
          state: 'streaming',
          statusText: 'conversation_island.status.assistant.streaming',
          title: 'Streaming research'
        }
      ]
    })
  })

  it('retains terminal activities while expanded and prunes them when collapsed', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('streaming', 100, 'topic-live')
    emitActivity('pending', 200, 'topic-primary')
    ;(service as unknown as { setExpanded(expanded: boolean): void }).setExpanded(true)

    emitActivity('done', 300, 'topic-primary')
    vi.setSystemTime(4_301)
    changePreference('app.language', 'fr-FR')
    expect(latestSnapshot()).toMatchObject({
      expanded: true,
      activities: [{ activityId: 'topic-primary', state: 'done' }, { activityId: 'topic-live' }]
    })
    expect(vi.getTimerCount()).toBe(0)

    ;(service as unknown as { setExpanded(expanded: boolean): void }).setExpanded(false)
    expect(latestSnapshot()).toMatchObject({ activityId: 'topic-live', expanded: false, secondaryCount: 0 })
    expect(latestSnapshot().activities).toBeUndefined()
  })

  it('reconciles updates in place, appends new activity, and promotes or collapses after removals', () => {
    const titles = new Map([
      ['topic-primary', 'Primary'],
      ['topic-second', 'Second'],
      ['topic-new', 'New']
    ])
    mocks.resolveName.mockImplementation((target: { conversationId: string }) => titles.get(target.conversationId))
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100, 'topic-second')
    emitActivity('streaming', 200, 'topic-primary')
    ;(service as unknown as { setExpanded(expanded: boolean): void }).setExpanded(true)

    titles.set('topic-second', 'Second turn')
    emitActivity('awaiting-approval', 300, 'topic-second', 'assistant', 'topic-second-turn-2')
    emitActivity('streaming', 400, 'topic-new')
    expect(latestSnapshot()).toMatchObject({
      activityId: 'topic-primary',
      expanded: true,
      activities: [
        { activityId: 'topic-primary', state: 'streaming', title: 'Primary' },
        { activityId: 'topic-second', state: 'awaiting-confirmation', title: 'Second turn' },
        { activityId: 'topic-new', state: 'streaming', title: 'New' }
      ]
    })

    emitActivity('aborted', 500, 'topic-primary')
    expect(latestSnapshot()).toMatchObject({
      activityId: 'topic-second',
      expanded: true,
      activities: [{ activityId: 'topic-second' }, { activityId: 'topic-new' }]
    })

    emitActivity('aborted', 600, 'topic-new')
    expect(latestSnapshot()).toMatchObject({ activityId: 'topic-second', expanded: false, secondaryCount: 0 })
    expect(latestSnapshot().activities).toBeUndefined()
  })

  it('clears expansion for display changes, resume, and disable', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100, 'topic-a')
    emitActivity('streaming', 200, 'topic-b')
    const setExpanded = () => {
      ;(service as unknown as { setExpanded(expanded: boolean): void }).setExpanded(true)
      expect(latestSnapshot().expanded).toBe(true)
    }

    setExpanded()
    mocks.screen.emit('display-added', {}, externalDisplay)
    expect(latestSnapshot().expanded).toBe(false)

    setExpanded()
    mocks.screen.emit('display-metrics-changed', {}, internalDisplay, ['bounds'])
    expect(latestSnapshot().expanded).toBe(false)

    setExpanded()
    mocks.displays = [externalDisplay]
    mocks.screen.emit('display-removed', {}, internalDisplay)
    expect(latestSnapshot().expanded).toBe(false)

    setExpanded()
    mocks.powerListener?.()
    expect(latestSnapshot().expanded).toBe(false)

    setExpanded()
    changePreference('feature.conversation_island.enabled', false)
    changePreference('feature.conversation_island.enabled', true)
    expect(services.windowManager.open.mock.lastCall?.[1]).toMatchObject({ initData: { expanded: false } })
  })

  it('rebuilds expanded titles and status text on language change without changing order', () => {
    const titles = new Map([
      ['topic-a', 'Alpha'],
      ['topic-b', 'Beta']
    ])
    mocks.resolveName.mockImplementation((target: { conversationId: string }) => titles.get(target.conversationId))
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('streaming', 100, 'topic-a')
    emitActivity('pending', 200, 'topic-b')
    ;(service as unknown as { setExpanded(expanded: boolean): void }).setExpanded(true)
    const order = latestSnapshot().activities.map((activity: { activityId: string }) => activity.activityId)

    titles.set('topic-a', 'Alpha traduit')
    titles.set('topic-b', 'Bêta traduit')
    mocks.i18nSuffix = '-fr'
    changePreference('app.language', 'fr-FR')

    expect(latestSnapshot().activities.map((activity: { activityId: string }) => activity.activityId)).toEqual(order)
    expect(latestSnapshot().activities).toMatchObject([
      {
        activityId: 'topic-b',
        title: 'Bêta traduit',
        statusText: 'conversation_island.status.assistant.pending-fr'
      },
      {
        activityId: 'topic-a',
        title: 'Alpha traduit',
        statusText: 'conversation_island.status.assistant.streaming-fr'
      }
    ])
  })

  it('derives expanded bounds from compact presentation on the frozen display', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100, 'topic-a')
    emitActivity('streaming', 200, 'topic-b')
    mocks.geometryResolve.mockClear()

    ;(service as unknown as { setExpanded(expanded: boolean): void }).setExpanded(true)

    expect(mocks.geometryResolve).toHaveBeenNthCalledWith(1, internalDisplay, expect.any(Map), {
      width: 320,
      height: 38
    })
    expect(mocks.geometrySize).toHaveBeenLastCalledWith('capsule', 2)
    expect(mocks.geometryResolve).toHaveBeenNthCalledWith(2, internalDisplay, expect.any(Map), {
      width: 420,
      height: 104
    })
    expect(latestSnapshot()).toMatchObject({ expanded: true, presentation: 'capsule' })
  })

  it('animates only changed follow-up bounds when reduced motion is disabled', () => {
    let offset = 0
    mocks.geometryResolve.mockImplementation(
      (display: any, _geometry: unknown, size: { width: number; height: number }) => ({
        bounds: { x: display.bounds.x + offset, y: display.bounds.y + 8, ...size },
        presentation: 'capsule'
      })
    )
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100)
    const window = mocks.windows.get('island-1')

    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 8, width: 320, height: 38 }, false)
    window.setBounds.mockClear()
    emitActivity('streaming', 200)
    expect(window.setBounds).not.toHaveBeenCalled()

    offset = 20
    emitActivity('awaiting-approval', 300)
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 20, y: 8, width: 320, height: 38 }, true)

    mocks.prefersReducedMotion = true
    offset = 40
    emitActivity('streaming', 400)
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 40, y: 8, width: 320, height: 38 }, false)
  })

  it('falls back to compact bounds when expanded presentation fails', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100, 'topic-a')
    emitActivity('streaming', 200, 'topic-b')
    const window = mocks.windows.get('island-1')
    window.setBounds.mockImplementationOnce(() => {
      throw new Error('expanded resize failed')
    })

    ;(service as unknown as { setExpanded(expanded: boolean): void }).setExpanded(true)

    expect(latestSnapshot()).toMatchObject({ expanded: false })
    expect(latestSnapshot().activities).toBeUndefined()
    expect(window.getBounds()).toEqual({ x: 0, y: 8, width: 320, height: 38 })
    expect(window.showInactive).toHaveBeenCalled()
  })

  it('dismisses the window when expanded presentation and compact retry both fail', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100, 'topic-a')
    emitActivity('streaming', 200, 'topic-b')
    const window = mocks.windows.get('island-1')
    window.showInactive.mockClear()
    window.showInactive.mockImplementationOnce(() => {
      throw new Error('expanded show failed')
    })
    window.showInactive.mockImplementationOnce(() => {
      throw new Error('compact show failed')
    })

    ;(service as unknown as { setExpanded(expanded: boolean): void }).setExpanded(true)

    expect(window.hide).toHaveBeenCalledOnce()
    expect(services.windowManager.close).toHaveBeenCalledWith('island-1')
    expect(mocks.windows.has('island-1')).toBe(false)
  })

  it('dismisses the expanded window when collapsing to compact bounds fails', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100, 'topic-a')
    emitActivity('streaming', 200, 'topic-b')
    ;(service as unknown as { setExpanded(expanded: boolean): void }).setExpanded(true)
    const window = mocks.windows.get('island-1')
    expect(window.getBounds().width).toBe(420)
    window.setBounds.mockImplementationOnce(() => {
      throw new Error('compact resize failed')
    })

    ;(service as unknown as { setExpanded(expanded: boolean): void }).setExpanded(false)

    expect(window.hide).toHaveBeenCalledOnce()
    expect(services.windowManager.close).toHaveBeenCalledWith('island-1')
    expect(mocks.windows.has('island-1')).toBe(false)
  })

  it('refreshes geometry for display and resume events only while enabled', async () => {
    mocks.screen.emit('display-added', {}, externalDisplay)
    expect(mocks.geometryProbe).not.toHaveBeenCalled()

    changePreference('feature.conversation_island.enabled', true)
    await flushPromises()
    expect(mocks.geometryProbe).toHaveBeenCalledTimes(1)

    mocks.screen.emit('display-added', {}, externalDisplay)
    mocks.screen.emit('display-removed', {}, externalDisplay)
    mocks.screen.emit('display-metrics-changed', {}, externalDisplay, ['bounds'])
    mocks.powerListener?.()
    await flushPromises()
    expect(mocks.geometryProbe).toHaveBeenCalledTimes(5)

    changePreference('feature.conversation_island.enabled', false)
    mocks.screen.emit('display-added', {}, externalDisplay)
    expect(mocks.geometryProbe).toHaveBeenCalledTimes(5)
    expect(mocks.powerListener).toBeUndefined()
  })

  it('isolates probe and window failures so a later state can recover', async () => {
    mocks.geometryProbe.mockRejectedValueOnce(new Error('probe failed'))
    changePreference('feature.conversation_island.enabled', true)
    await flushPromises()
    expect(mocks.loggerWarn).toHaveBeenCalled()

    mocks.openError = new Error('window failed')
    expect(() => emitActivity('pending', 100)).not.toThrow()
    expect(mocks.loggerError).toHaveBeenCalled()

    emitActivity('streaming', 200)
    expect(services.windowManager.open).toHaveBeenCalledTimes(2)
    expect(mocks.windows.has('island-1')).toBe(true)
  })

  it('cleans listeners, active probes, timers, and the transient window on stop', async () => {
    const assistantCacheDisposer = mocks.cacheDisposers.get('topic.stream.statuses.${topicId}')
    const agentCacheDisposer = mocks.cacheDisposers.get('topic.stream.statuses.agent-session:${sessionId}')
    let signal: AbortSignal | undefined
    mocks.geometryProbe.mockImplementationOnce((value: AbortSignal) => {
      signal = value
      return new Promise(() => {})
    })
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('done', 100)

    await service._doStop()

    expect(signal?.aborted).toBe(true)
    expect(assistantCacheDisposer).toHaveBeenCalledOnce()
    expect(agentCacheDisposer).toHaveBeenCalledOnce()
    expect(mocks.cacheSubscriptions.size).toBe(0)
    expect(mocks.powerListener).toBeUndefined()
    expect(mocks.screenListeners.size === 0 || [...mocks.screenListeners.values()].every((set) => set.size === 0)).toBe(
      true
    )
    expect(services.windowManager.close).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
