import { BaseService } from '@main/core/lifecycle'
import { getDependencies } from '@main/core/lifecycle/decorators'
import { type WindowInfo, WindowType } from '@main/core/window/types'
import type { TopicStatusSnapshotEntry, TopicStreamStatus } from '@shared/ai/transport'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConversationIslandCommand, ConversationIslandHelperEvent } from '../conversationIslandProtocol'

type CacheListener = (
  value: TopicStatusSnapshotEntry | null | undefined,
  oldValue: TopicStatusSnapshotEntry | null | undefined,
  concreteKey: string
) => void
type PresentCommand = Extract<ConversationIslandCommand, { type: 'present' }>
type SetExpandedEvent = Extract<ConversationIslandHelperEvent, { type: 'setExpanded' }>
type OpenActivityEvent = Extract<ConversationIslandHelperEvent, { type: 'openActivity' }>

const mocks = vi.hoisted(() => ({
  animationSettingsError: undefined as Error | undefined,
  cacheDisposers: new Map<string, ReturnType<typeof vi.fn>>(),
  cacheSubscriptions: new Map<string, CacheListener>(),
  darkAppearance: false,
  displays: [] as any[],
  focusedWindowInfos: [] as WindowInfo[],
  hostCallbacks: undefined as
    | {
        onSetExpanded?: (event: SetExpandedEvent) => void
        onOpenActivity?: (event: OpenActivityEvent) => void
      }
    | undefined,
  hostDismiss: vi.fn(),
  hostPresent: vi.fn(),
  hostResetCircuit: vi.fn(),
  hostShutdown: vi.fn(() => Promise.resolve()),
  i18nSuffix: '',
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  name: 'Research notes',
  agent: { name: 'Coding Agent', configuration: { avatar: '🤖' } } as any,
  agentId: 'agent-1' as string | null,
  assistant: { name: 'Research Assistant', emoji: '🔬' } as any,
  assistantId: 'assistant-1' as string | null,
  navigationFocusOrOpen: vi.fn(() => Promise.resolve()),
  preferenceListeners: new Map<string, (value: any) => void>(),
  preferences: new Map<string, any>(),
  prefersReducedMotion: false,
  resolveName: vi.fn(),
  resolveAgent: vi.fn(),
  resolveAgentId: vi.fn(),
  resolveAssistant: vi.fn(),
  resolveAssistantId: vi.fn(),
  sourceWindows: new Map<string, any>(),
  themeListeners: new Set<() => void>()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError, warn: mocks.loggerWarn }) }
}))

vi.mock('@main/i18n', () => ({
  t: (key: string, options?: { count?: number }) => {
    const fallback: Record<string, string> = {
      'agent.session.new': 'New task',
      'chat.conversation.new': 'New Chat'
    }
    if (key === 'conversation_island.activity_count') return `Total: ${options?.count}${mocks.i18nSuffix}`
    return `${fallback[key] ?? key}${mocks.i18nSuffix}`
  }
}))

vi.mock('@main/utils/fullChromeWindows', () => ({
  getFullChromeWindowInfos: () => mocks.focusedWindowInfos
}))

vi.mock('../ConversationIslandNativeHost', () => ({
  ConversationIslandNativeHost: class {
    constructor(options?: {
      callbacks?: {
        onSetExpanded?: (event: SetExpandedEvent) => void
        onOpenActivity?: (event: OpenActivityEvent) => void
      }
    }) {
      mocks.hostCallbacks = options?.callbacks
    }

    present = mocks.hostPresent
    dismiss = mocks.hostDismiss
    resetCircuit = mocks.hostResetCircuit
    shutdown = mocks.hostShutdown
  }
}))

vi.mock('electron', () => ({
  nativeTheme: {
    get shouldUseDarkColors() {
      return mocks.darkAppearance
    },
    on: vi.fn((_event: string, listener: () => void) => mocks.themeListeners.add(listener)),
    removeListener: vi.fn((_event: string, listener: () => void) => mocks.themeListeners.delete(listener))
  },
  screen: {
    getAllDisplays: vi.fn(() => mocks.displays),
    getPrimaryDisplay: vi.fn(() => mocks.displays[0]),
    getDisplayMatching: vi.fn((bounds: { x: number }) =>
      bounds.x >= 1512 ? mocks.displays.find((display) => display.id === 2) : mocks.displays[0]
    )
  },
  systemPreferences: {
    getAnimationSettings: () => {
      if (mocks.animationSettingsError) throw mocks.animationSettingsError
      return {
        shouldRenderRichAnimation: true,
        scrollAnimationsEnabledBySystem: true,
        prefersReducedMotion: mocks.prefersReducedMotion
      }
    }
  }
}))

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

  const windowManager = {
    getWindow: vi.fn((id: string) => mocks.sourceWindows.get(id))
  }

  const navigationService = { focusOrOpen: mocks.navigationFocusOrOpen }
  return { cacheService, navigationService, preferenceService, windowManager }
})

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    getById: (conversationId: string) => ({
      agentId: mocks.resolveAgentId(conversationId),
      name: mocks.resolveName({ conversationType: 'agent', conversationId })
    })
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: (agentId: string) => mocks.resolveAgent(agentId) }
}))

vi.mock('@data/services/AssistantService', () => ({
  assistantDataService: { getById: (assistantId: string) => mocks.resolveAssistant(assistantId) }
}))

vi.mock('@data/services/TopicService', () => ({
  topicService: {
    getById: (conversationId: string) => ({
      assistantId: mocks.resolveAssistantId(conversationId),
      name: mocks.resolveName({ conversationType: 'assistant', conversationId })
    })
  }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      const service = {
        CacheService: services.cacheService,
        ConversationNavigationService: services.navigationService,
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

function createSourceWindow(bounds: { x: number; y: number; width: number; height: number }) {
  return {
    getBounds: vi.fn(() => bounds),
    isDestroyed: vi.fn(() => false)
  }
}

function emitActivity(
  status: TopicStreamStatus | null,
  changedAt: number,
  topicId = 'topic-1',
  conversationType: 'assistant' | 'agent' = 'assistant',
  turnId = `${topicId}-turn`,
  awaitingApproval = status === 'awaiting-approval'
): void {
  vi.setSystemTime(changedAt)
  const pattern =
    conversationType === 'agent'
      ? 'topic.stream.statuses.agent-session:${sessionId}'
      : 'topic.stream.statuses.${topicId}'
  const concreteTopicId = conversationType === 'agent' ? `agent-session:${topicId}` : topicId
  const approvalAnchor = {
    executionId: 'provider::model' as const,
    attemptId: 1,
    anchorMessageId: 'assistant-message-1'
  }
  mocks.cacheSubscriptions.get(pattern)?.(
    status === null
      ? null
      : {
          status: status === 'awaiting-approval' ? 'streaming' : status,
          turnId,
          activeExecutions: awaitingApproval ? [approvalAnchor] : [],
          awaitingApprovalAnchors: awaitingApproval ? [approvalAnchor] : []
        },
    null,
    `topic.stream.statuses.${concreteTopicId}`
  )
}

function changePreference(key: string, value: unknown): void {
  mocks.preferences.set(key, value)
  mocks.preferenceListeners.get(key)?.(value)
}

function latestPresent(): PresentCommand {
  const command = mocks.hostPresent.mock.lastCall?.[0] as PresentCommand | undefined
  if (!command) throw new Error('Expected a native present command')
  return command
}

function sendSetExpanded(revision: number, expanded: boolean): void {
  mocks.hostCallbacks?.onSetExpanded?.({ version: 1, type: 'setExpanded', revision, expanded })
}

function sendOpenActivity(revision: number, activityId: string): void {
  mocks.hostCallbacks?.onOpenActivity?.({ version: 1, type: 'openActivity', revision, activityId })
}

describe('ConversationIslandService', () => {
  let service: InstanceType<typeof ConversationIslandService>

  beforeEach(async () => {
    BaseService.resetInstances()
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.clearAllMocks()
    mocks.animationSettingsError = undefined
    mocks.cacheDisposers.clear()
    mocks.cacheSubscriptions.clear()
    mocks.darkAppearance = false
    mocks.displays = [internalDisplay, externalDisplay]
    mocks.focusedWindowInfos = []
    mocks.hostCallbacks = undefined
    mocks.hostShutdown.mockResolvedValue(undefined)
    mocks.i18nSuffix = ''
    mocks.name = 'Research notes'
    mocks.agent = { name: 'Coding Agent', configuration: { avatar: '🤖' } }
    mocks.agentId = 'agent-1'
    mocks.assistant = { name: 'Research Assistant', emoji: '🔬' }
    mocks.assistantId = 'assistant-1'
    mocks.preferenceListeners.clear()
    mocks.preferences.clear()
    mocks.preferences.set('feature.conversation_island.enabled', false)
    mocks.preferences.set('app.language', 'en-US')
    mocks.preferences.set('ui.theme_user.color_primary', '#123ABC')
    mocks.preferences.set('ui.theme_user.font_family', 'Inter')
    mocks.prefersReducedMotion = false
    mocks.resolveName.mockImplementation(() => mocks.name)
    mocks.resolveAgent.mockImplementation(() => mocks.agent)
    mocks.resolveAgentId.mockImplementation(() => mocks.agentId)
    mocks.resolveAssistant.mockImplementation(() => mocks.assistant)
    mocks.resolveAssistantId.mockImplementation(() => mocks.assistantId)
    mocks.sourceWindows.clear()
    mocks.sourceWindows.set('main-1', createSourceWindow({ x: 1600, y: 20, width: 1000, height: 700 }))
    mocks.themeListeners.clear()

    service = new ConversationIslandService()
    await service._doInit()
  })

  afterEach(async () => {
    await service._doStop()
    vi.clearAllTimers()
    vi.useRealTimers()
    BaseService.resetInstances()
  })

  it('declares only the same-phase services it consumes', () => {
    expect(getDependencies(ConversationIslandService)).toEqual(['WindowManager', 'ConversationNavigationService'])
  })

  it('observes assistant and agent-session activities through their exact cache patterns', () => {
    expect([...mocks.cacheSubscriptions.keys()]).toEqual([
      'topic.stream.statuses.${topicId}',
      'topic.stream.statuses.agent-session:${sessionId}'
    ])
  })

  it('does not present or spawn the helper merely because the feature is enabled', () => {
    changePreference('feature.conversation_island.enabled', true)

    expect(mocks.hostResetCircuit).toHaveBeenCalledOnce()
    expect(mocks.hostPresent).not.toHaveBeenCalled()
  })

  it('retains disabled activity and presents it on its originating display when enabled', () => {
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
    expect(mocks.hostPresent).not.toHaveBeenCalled()

    changePreference('feature.conversation_island.enabled', true)

    expect(latestPresent().payload.displayId).toBe(2)
  })

  it('projects trusted assistant and agent metadata without navigation targets on the wire', () => {
    mocks.resolveName.mockImplementation(
      (target: { conversationType: 'assistant' | 'agent'; conversationId: string }) =>
        `${target.conversationType}:${target.conversationId}`
    )
    changePreference('feature.conversation_island.enabled', true)

    emitActivity('streaming', 100, 'topic-assistant', 'assistant')
    expect(latestPresent().payload.activities[0]).toEqual({
      activityId: 'topic-assistant',
      identityAvatar: '🔬',
      identityName: 'Research Assistant',
      state: 'streaming',
      statusText: 'conversation_island.status.assistant.streaming',
      title: 'assistant:topic-assistant'
    })
    expect(latestPresent().payload.activities[0]).not.toHaveProperty('target')

    emitActivity('aborted', 200, 'topic-assistant', 'assistant')
    emitActivity('streaming', 300, 'session-1', 'agent')
    expect(latestPresent().payload.activities[0]).toMatchObject({
      activityId: 'agent-session:session-1',
      identityAvatar: '🤖',
      identityName: 'Coding Agent',
      title: 'agent:session-1'
    })
    expect(latestPresent().payload.activities[0]).not.toHaveProperty('target')
  })

  it('sends only the primary item while collapsed but keeps the full activity count', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('streaming', 100, 'topic-old')
    emitActivity('pending', 200, 'topic-new')

    expect(latestPresent().payload).toMatchObject({
      expanded: false,
      primaryActivityId: 'topic-new',
      activityCountText: 'Total: 2',
      activities: [{ activityId: 'topic-new' }]
    })
  })

  it('keeps frozen expanded order and projects approval state in a complete snapshot', () => {
    const titles = new Map([
      ['topic-streaming', 'Streaming research'],
      ['topic-approval', 'Approval request'],
      ['topic-new', 'New work']
    ])
    mocks.resolveName.mockImplementation((target: { conversationId: string }) => titles.get(target.conversationId))
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('streaming', 100, 'topic-streaming')
    emitActivity('awaiting-approval', 200, 'topic-approval', 'agent')

    sendSetExpanded(latestPresent().revision, true)
    emitActivity('streaming', 300, 'topic-new')

    expect(latestPresent().payload).toMatchObject({
      expanded: true,
      primaryActivityId: 'agent-session:topic-approval',
      activities: [
        { activityId: 'agent-session:topic-approval', state: 'awaiting-confirmation', title: 'Approval request' },
        { activityId: 'topic-streaming', state: 'streaming', title: 'Streaming research' },
        { activityId: 'topic-new', state: 'streaming', title: 'New work' }
      ]
    })
  })

  it('refreshes appearance, primary color, font, and localized text from Electron-owned state', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('streaming', 100)
    expect(latestPresent().payload.theme).toEqual({
      appearance: 'light',
      primaryColor: '#123ABC',
      fontFamily: 'Inter'
    })

    mocks.darkAppearance = true
    for (const listener of mocks.themeListeners) listener()
    expect(latestPresent().payload.theme.appearance).toBe('dark')

    changePreference('ui.theme_user.color_primary', 'rgb(0, 1, 2)')
    expect(latestPresent().payload.theme.primaryColor).toBe('#00B96B')

    changePreference('ui.theme_user.color_primary', '#0f8')
    expect(latestPresent().payload.theme.primaryColor).toBe('#0f8')

    changePreference('ui.theme_user.font_family', 'SF Pro')
    expect(latestPresent().payload.theme.fontFamily).toBe('SF Pro')

    mocks.name = ''
    mocks.i18nSuffix = '-fr'
    changePreference('app.language', 'fr-FR')
    expect(latestPresent().payload.activities[0]).toMatchObject({
      title: 'New Chat-fr',
      statusText: 'conversation_island.status.assistant.streaming-fr'
    })
  })

  it.each([
    { setting: true, expected: true },
    { setting: false, expected: false }
  ])('projects reduced motion $setting into the native payload', ({ setting, expected }) => {
    changePreference('feature.conversation_island.enabled', true)
    mocks.prefersReducedMotion = setting
    emitActivity('pending', 100)

    expect(latestPresent().payload.reducedMotion).toBe(expected)
  })

  it('falls back to reduced motion when Electron animation settings cannot be read', () => {
    changePreference('feature.conversation_island.enabled', true)
    mocks.animationSettingsError = new Error('settings unavailable')
    emitActivity('pending', 100)

    expect(latestPresent().payload.reducedMotion).toBe(true)
  })

  it('accepts only the current revision for expansion interactions', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100, 'topic-a')
    emitActivity('streaming', 200, 'topic-b')
    const compactRevision = latestPresent().revision

    sendSetExpanded(compactRevision - 1, true)
    expect(latestPresent().payload.expanded).toBe(false)

    sendSetExpanded(compactRevision, true)
    expect(latestPresent().revision).toBeGreaterThan(compactRevision)
    expect(latestPresent().payload.expanded).toBe(true)
    expect(latestPresent().payload.activities).toHaveLength(2)
  })

  it('collapses with a fresh revision before navigating a valid activity', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('streaming', 100, 'topic-a')
    emitActivity('pending', 200, 'topic-b')
    sendSetExpanded(latestPresent().revision, true)
    const expandedRevision = latestPresent().revision
    mocks.hostPresent.mockClear()
    mocks.navigationFocusOrOpen.mockClear()

    sendOpenActivity(expandedRevision, 'topic-a')

    const compact = latestPresent()
    expect(compact.revision).toBeGreaterThan(expandedRevision)
    expect(compact.payload).toMatchObject({ expanded: false, activities: [{ activityId: 'topic-b' }] })
    expect(mocks.navigationFocusOrOpen).toHaveBeenCalledWith(
      { conversationType: 'assistant', conversationId: 'topic-a' },
      'Research notes'
    )
    expect(mocks.navigationFocusOrOpen.mock.lastCall).toHaveLength(2)
    expect(mocks.hostPresent.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.navigationFocusOrOpen.mock.invocationCallOrder[0]
    )
  })

  it('rejects stale revisions and activity IDs that were not in the current presentation', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('streaming', 100, 'topic-secondary')
    emitActivity('pending', 200, 'topic-primary')
    const revision = latestPresent().revision

    sendOpenActivity(revision - 1, 'topic-primary')
    sendOpenActivity(revision, 'topic-secondary')
    sendOpenActivity(revision, 'missing')

    expect(mocks.navigationFocusOrOpen).not.toHaveBeenCalled()
  })

  it('dismisses for disable, resets the circuit on re-enable, and restores live activity', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100)
    const presentRevision = latestPresent().revision
    mocks.hostResetCircuit.mockClear()

    changePreference('feature.conversation_island.enabled', false)
    expect(mocks.hostDismiss).toHaveBeenLastCalledWith(
      { version: 1, type: 'dismiss', revision: expect.any(Number) },
      true
    )
    expect(mocks.hostDismiss.mock.lastCall?.[0].revision).toBeGreaterThan(presentRevision)

    changePreference('feature.conversation_island.enabled', true)
    expect(mocks.hostResetCircuit).toHaveBeenCalledOnce()
    expect(latestPresent().payload.activities[0].activityId).toBe('topic-1')
  })

  it('uses a normal dismiss when the final activity disappears', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100)
    const presentRevision = latestPresent().revision

    emitActivity(null, 200)

    expect(mocks.hostDismiss).toHaveBeenLastCalledWith(
      { version: 1, type: 'dismiss', revision: expect.any(Number) },
      false
    )
    expect(mocks.hostDismiss.mock.lastCall?.[0].revision).toBeGreaterThan(presentRevision)
  })

  it('expires terminal activities at their existing TTL before normally dismissing', async () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('done', 100, 'topic-done')

    await vi.advanceTimersByTimeAsync(3_999)
    expect(mocks.hostDismiss).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.hostDismiss).toHaveBeenCalledWith(expect.any(Object), false)

    emitActivity('error', 5_000, 'topic-error')
    mocks.hostDismiss.mockClear()
    await vi.advanceTimersByTimeAsync(5_999)
    expect(mocks.hostDismiss).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.hostDismiss).toHaveBeenCalledWith(expect.any(Object), false)
  })

  it('caches metadata during one turn and resolves it again for a new turn', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100, 'topic-1', 'assistant', 'turn-1')
    emitActivity('streaming', 200, 'topic-1', 'assistant', 'turn-1')
    expect(mocks.resolveName).toHaveBeenCalledOnce()
    expect(mocks.resolveAssistant).toHaveBeenCalledOnce()

    emitActivity('aborted', 300, 'topic-1', 'assistant', 'turn-1')
    mocks.name = 'Renamed conversation'
    emitActivity('pending', 400, 'topic-1', 'assistant', 'turn-2')

    expect(mocks.resolveName).toHaveBeenCalledTimes(2)
    expect(latestPresent().payload.activities[0].title).toBe('Renamed conversation')
  })

  it('uses localized identity fallbacks without weakening navigation ownership', () => {
    mocks.resolveAssistant.mockImplementation(() => {
      throw new Error('assistant missing')
    })
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100)

    expect(latestPresent().payload.activities[0]).toMatchObject({
      identityAvatar: '😀',
      identityName: 'conversation_island.identity.assistant',
      title: 'Research notes'
    })
  })

  it('retains expired terminal items while expanded and prunes them after collapse', () => {
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('streaming', 100, 'topic-live')
    emitActivity('pending', 200, 'topic-primary')
    sendSetExpanded(latestPresent().revision, true)

    emitActivity('done', 300, 'topic-primary')
    vi.setSystemTime(4_301)
    changePreference('app.language', 'fr-FR')
    expect(latestPresent().payload.activities).toMatchObject([
      { activityId: 'topic-primary', state: 'done' },
      { activityId: 'topic-live' }
    ])

    sendSetExpanded(latestPresent().revision, false)
    expect(latestPresent().payload).toMatchObject({
      expanded: false,
      primaryActivityId: 'topic-live',
      activities: [{ activityId: 'topic-live' }]
    })
  })

  it('awaits host shutdown and removes subscriptions on stop', async () => {
    const assistantDisposer = mocks.cacheDisposers.get('topic.stream.statuses.${topicId}')
    const agentDisposer = mocks.cacheDisposers.get('topic.stream.statuses.agent-session:${sessionId}')
    let resolveShutdown: (() => void) | undefined
    mocks.hostShutdown.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveShutdown = resolve
        })
    )
    changePreference('feature.conversation_island.enabled', true)
    emitActivity('pending', 100)

    let stopped = false
    const stopPromise = service._doStop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(mocks.hostShutdown).toHaveBeenCalledOnce()

    resolveShutdown?.()
    await stopPromise
    expect(assistantDisposer).toHaveBeenCalledOnce()
    expect(agentDisposer).toHaveBeenCalledOnce()
    expect(mocks.cacheSubscriptions.size).toBe(0)
    expect(mocks.preferenceListeners.size).toBe(0)
    expect(mocks.themeListeners.size).toBe(0)
  })
})
