import { BaseService } from '@main/core/lifecycle'
import { type WindowInfo, WindowType } from '@main/core/window/types'
import type { TopicStreamStatus } from '@shared/ai/transport'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    createdListeners: [] as Array<(managed: any) => void>,
    destroyedListeners: [] as Array<(managed: any) => void>,
    displays: [] as any[],
    focusedWindowInfos: [] as WindowInfo[],
    geometryProbe: vi.fn(),
    geometryResolve: vi.fn(),
    i18nSuffix: '',
    loggerError: vi.fn(),
    loggerWarn: vi.fn(),
    name: 'Research notes',
    openError: undefined as Error | undefined,
    powerListener: undefined as (() => void) | undefined,
    preferenceListeners: new Map<string, (value: any) => void>(),
    preferences: new Map<string, any>(),
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
  probeMacScreenGeometry: (...args: unknown[]) => mocks.geometryProbe(...args),
  resolveConversationIslandBounds: (...args: unknown[]) => mocks.geometryResolve(...args)
}))

vi.mock('electron', () => ({ screen: mocks.screen }))

function createWindow(bounds = { x: 0, y: 0, width: 320, height: 38 }) {
  return {
    getBounds: vi.fn(() => bounds),
    isDestroyed: vi.fn(() => false),
    setBounds: vi.fn(),
    showInactive: vi.fn()
  }
}

const services = vi.hoisted(() => {
  const notificationService = {
    onConversationActivityChanged: vi.fn((listener: (event: any) => void) => {
      mocks.activitiesListener = listener
      return {
        dispose: vi.fn(() => {
          if (mocks.activitiesListener === listener) mocks.activitiesListener = undefined
        })
      }
    }),
    resolveConversationName: (...args: unknown[]) => mocks.resolveName(...args)
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

  return { notificationService, powerService, preferenceService, windowManager }
})

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      const service = {
        NotificationService: services.notificationService,
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
  mocks.activitiesListener?.({
    topicId,
    target: { conversationType, conversationId: topicId },
    snapshot: status === null ? null : { status, turnId, activeExecutions: [], awaitingApprovalAnchors: [] },
    changedAt
  })
}

function changePreference(key: string, value: unknown): void {
  mocks.preferences.set(key, value)
  mocks.preferenceListeners.get(key)?.(value)
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
    mocks.createdListeners.length = 0
    mocks.destroyedListeners.length = 0
    mocks.displays = [internalDisplay, externalDisplay]
    mocks.focusedWindowInfos = []
    mocks.geometryProbe.mockResolvedValue(new Map())
    mocks.geometryResolve.mockImplementation((display: any, _geometry: unknown, width: number) => ({
      bounds: { x: display.bounds.x, y: display.bounds.y + 8, width, height: 38 },
      presentation: 'capsule'
    }))
    mocks.i18nSuffix = ''
    mocks.name = 'Research notes'
    mocks.openError = undefined
    mocks.powerListener = undefined
    mocks.preferenceListeners.clear()
    mocks.preferences.clear()
    mocks.preferences.set('feature.conversation_island.enabled', false)
    mocks.preferences.set('feature.conversation_island.show_title', true)
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
  })

  afterEach(async () => {
    await service._doStop()
    vi.clearAllTimers()
    vi.useRealTimers()
    BaseService.resetInstances()
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
    expect(mocks.geometryResolve).toHaveBeenCalledWith(externalDisplay, expect.any(Map), 320)
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

  it('does not resolve business titles when title display is disabled', () => {
    changePreference('feature.conversation_island.show_title', false)
    changePreference('feature.conversation_island.enabled', true)

    emitActivity('pending', 100)

    const snapshot = (services.windowManager.open.mock.calls[0][1] as { initData: unknown }).initData
    expect(mocks.resolveName).not.toHaveBeenCalled()
    expect(snapshot).toMatchObject({ title: undefined, navigationTitle: 'New Chat', state: 'pending' })
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
      navigationTitle: 'Research notes',
      state: 'streaming'
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
      initData: { title: 'Renamed conversation', navigationTitle: 'Renamed conversation' }
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

  it('recomputes title and localized text when preferences or language change', () => {
    changePreference('feature.conversation_island.show_title', false)
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('streaming', 100)
    expect(mocks.resolveName).not.toHaveBeenCalled()

    changePreference('feature.conversation_island.show_title', true)
    expect(mocks.resolveName).toHaveBeenCalledOnce()

    mocks.name = 'Notes translated'
    mocks.i18nSuffix = '-fr'
    changePreference('app.language', 'fr-FR')

    expect(mocks.resolveName).toHaveBeenCalledTimes(2)
    expect(services.windowManager.pushInitData.mock.lastCall?.[1]).toMatchObject({
      navigationTitle: 'Notes translated',
      statusText: 'conversation_island.status.assistant.streaming-fr'
    })
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
    let signal: AbortSignal | undefined
    mocks.geometryProbe.mockImplementationOnce((value: AbortSignal) => {
      signal = value
      return new Promise(() => {})
    })
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('done', 100)

    await service._doStop()

    expect(signal?.aborted).toBe(true)
    expect(mocks.activitiesListener).toBeUndefined()
    expect(mocks.powerListener).toBeUndefined()
    expect(mocks.screenListeners.size === 0 || [...mocks.screenListeners.values()].every((set) => set.size === 0)).toBe(
      true
    )
    expect(services.windowManager.close).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
