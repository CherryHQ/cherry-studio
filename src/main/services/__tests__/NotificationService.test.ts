import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { notificationRecordService } from '@data/services/NotificationRecordService'
import type { ConversationCompletedEvent } from '@main/ai/streamManager'
import { AiStreamManager } from '@main/ai/streamManager'
import { PersistenceListener } from '@main/ai/streamManager/listeners/PersistenceListener'
import { MessageServiceBackend } from '@main/ai/streamManager/persistence/backends/MessageServiceBackend'
import type { ApprovalRequestedEvent } from '@main/ai/types'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import { BaseService } from '@main/core/lifecycle'
import { type WindowInfo, WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'

const NOTIFICATION_PREF_KEYS = [
  'app.notification.assistant.enabled',
  'app.notification.backup.enabled',
  'app.notification.knowledge.enabled',
  'app.notification.update.enabled',
  'app.notification.mini_app.enabled',
  'app.notification.usage.os.enabled'
] as const

const mocks = vi.hoisted(() => ({
  agentSessionGetById: vi.fn(),
  agentApprovalListener: undefined as ((event: ApprovalRequestedEvent) => void) | undefined,
  applicationGet: vi.fn(),
  broadcastToType: vi.fn(),
  completionListener: undefined as ((event: ConversationCompletedEvent) => void) | undefined,
  electronNotifications: [] as Array<{
    options: { title: string; body: string }
    click?: () => void
    show: ReturnType<typeof vi.fn<() => void>>
  }>,
  focusOrOpen: vi.fn(() => Promise.resolve()),
  isActiveInFocusedWindow: vi.fn(async () => false),
  getWindowInfosByType: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  preferenceGet: vi.fn(),
  preferenceValues: {} as Record<string, boolean | number>,
  send: vi.fn(),
  setBadgeCount: vi.fn(() => true),
  showMainWindow: vi.fn(),
  streamApprovalListener: undefined as ((event: ApprovalRequestedEvent) => void) | undefined,
  subscribeMultipleChanges: vi.fn(),
  topicGetById: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mocks.agentSessionGetById }
}))
vi.mock('@data/services/TopicService', async (importOriginal) => {
  await importOriginal()
  return { topicService: { getById: mocks.topicGetById } }
})
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: mocks.loggerError, warn: mocks.loggerWarn, info: vi.fn(), debug: vi.fn() })
  }
}))
vi.mock('@main/i18n', () => ({
  t: vi.fn(
    (key: string) =>
      ({
        'agent.session.new': 'New task',
        'chat.conversation.new': 'New Chat',
        'notification.action_required.agent': 'Agent needs your input',
        'notification.action_required.assistant': 'Assistant needs your input',
        'notification.completion.agent': 'Agent task complete',
        'notification.completion.assistant': 'Assistant response complete'
      })[key] ?? key
  )
}))
vi.mock('electron', () => ({
  app: {
    setBadgeCount: (...args: Parameters<typeof mocks.setBadgeCount>) => mocks.setBadgeCount(...args)
  },
  Notification: class {
    private readonly state: (typeof mocks.electronNotifications)[number]

    constructor(options: { title: string; body: string }) {
      this.state = { options, show: vi.fn() }
      mocks.electronNotifications.push(this.state)
    }

    on(event: string, listener: () => void) {
      if (event === 'click') this.state.click = listener
      return this
    }

    show() {
      this.state.show()
    }
  }
}))

const { NotificationService } = await import('../NotificationService')

const mainWindowInfo = (overrides: Partial<WindowInfo> = {}): WindowInfo => ({
  id: 'main-1',
  type: WindowType.Main,
  title: 'Cherry Studio',
  isVisible: false,
  isFocused: false,
  createdAt: 1,
  ...overrides
})

function emitCompletion(overrides: Partial<ConversationCompletedEvent> = {}): void {
  mocks.completionListener?.({
    topicId: 'topic-1',
    turnId: 'turn-1',
    completedAt: Date.now(),
    responseText: 'I checked the implementation. Here is the final answer.',
    ...overrides
  })
}

function emitApproval(overrides: Partial<ApprovalRequestedEvent> = {}, source: 'stream' | 'agent' = 'stream'): void {
  const listener = source === 'stream' ? mocks.streamApprovalListener : mocks.agentApprovalListener
  listener?.({
    topicId: 'topic-1',
    approvalId: 'approval-1',
    requestedAt: 200,
    ...overrides
  })
}

describe('NotificationService', () => {
  const dbh = setupTestDatabase()
  let service: InstanceType<typeof NotificationService>
  let notificationPrefListener: ((key: string, newValue: boolean, oldValue: boolean) => void) | undefined

  async function initService(): Promise<void> {
    if (service) await service._doStop()
    service = new NotificationService()
    await service._doInit()
  }

  beforeEach(async () => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.send.mockReset()
    mocks.isActiveInFocusedWindow.mockResolvedValue(false)
    mocks.electronNotifications.length = 0
    mocks.agentApprovalListener = undefined
    mocks.completionListener = undefined
    mocks.streamApprovalListener = undefined
    notificationPrefListener = undefined
    mocks.getWindowInfosByType.mockReturnValue([])
    mocks.preferenceValues = Object.fromEntries(NOTIFICATION_PREF_KEYS.map((key) => [key, true]))
    mocks.preferenceValues['app.notification.completion_sound.enabled'] = false
    mocks.preferenceValues['app.notification.daily_budget.tokens'] = 0
    mocks.preferenceValues['app.notification.daily_budget.threshold'] = 80
    mocks.preferenceGet.mockImplementation((key: string) => mocks.preferenceValues[key] ?? true)
    mocks.subscribeMultipleChanges.mockImplementation((keys, listener) => {
      if (keys.includes('app.notification.assistant.enabled')) notificationPrefListener = listener
      return vi.fn()
    })
    mocks.topicGetById.mockReturnValue({ name: 'Research notes' })
    mocks.agentSessionGetById.mockReturnValue({ name: 'Refactor project' })
    const originalGet = application.getContainer().get.bind(application.getContainer())
    vi.spyOn(application, 'get').mockImplementation(((name: string) => {
      if (name === 'AiStreamManager') {
        return {
          onApprovalRequested: (listener: (event: ApprovalRequestedEvent) => void) => {
            mocks.streamApprovalListener = listener
            return { dispose: vi.fn() }
          },
          onConversationCompleted: (listener: (event: ConversationCompletedEvent) => void) => {
            mocks.completionListener = listener
            return { dispose: vi.fn() }
          }
        }
      }
      if (name === 'AgentSessionRuntimeService') {
        return {
          onApprovalRequested: (listener: (event: ApprovalRequestedEvent) => void) => {
            mocks.agentApprovalListener = listener
            return { dispose: vi.fn() }
          }
        }
      }
      if (name === 'ConversationNavigationService')
        return { focusOrOpen: mocks.focusOrOpen, isActiveInFocusedWindow: mocks.isActiveInFocusedWindow }
      if (name === 'WindowManager') return { getWindowInfosByType: mocks.getWindowInfosByType }
      if (name === 'IpcApiService') return { send: mocks.send, broadcastToType: mocks.broadcastToType }
      if (name === 'MainWindowService') return { showMainWindow: mocks.showMainWindow }
      if (name === 'PreferenceService') {
        return { get: mocks.preferenceGet, subscribeMultipleChanges: mocks.subscribeMultipleChanges }
      }
      return originalGet(name as never)
    }) as typeof application.get)

    await initService()
    // Init reads notification prefs for Dock-badge sync; action tests care about later calls only.
    mocks.preferenceGet.mockClear()
    mocks.setBadgeCount.mockClear()
  })

  afterEach(async () => {
    await service._doStop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('persists completions with OS delivery off and never resurrects a dismissed duplicate', () => {
    mocks.preferenceValues['app.notification.assistant.enabled'] = false
    emitCompletion()
    const [record] = notificationRecordService.list({}).items
    expect(record).toMatchObject({ category: 'system', kind: 'task-completion', readAt: null })
    expect(mocks.electronNotifications).toHaveLength(0)
    notificationRecordService.dismiss(record.id)
    emitCompletion()
    expect(notificationRecordService.list({}).items).toEqual([])
    expect(notificationRecordService.unreadCount()).toBe(0)
  })

  it.each(['assistant', 'agent'] as const)(
    'reads all notifications only for the entered %s conversation',
    (conversationType) => {
      const create = (eventKey: string, target: Parameters<typeof notificationRecordService.create>[0]['target']) =>
        notificationRecordService.create({
          eventKey,
          category: 'system',
          kind: 'task-completion',
          title: 'Done',
          message: 'Finished',
          createdAt: Date.now(),
          target
        })!
      const target = { kind: 'conversation' as const, conversationType, conversationId: 'shared-id' }
      const matching = Array.from({ length: 55 }, (_, index) => create(`matching:${index}`, target))
      const otherType = create('other-type', {
        ...target,
        conversationType: conversationType === 'agent' ? 'assistant' : 'agent'
      })
      const otherConversation = create('other-conversation', { ...target, conversationId: 'other-id' })
      const unrelated = create('unrelated', { kind: 'settings', tab: 'usage' })
      notificationRecordService.markRead(matching[0].id)
      const originalReadAt = notificationRecordService.getById(matching[0].id)!.readAt
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
      notificationRecordService.markConversationRead(target)
      expect(matching.every(({ id }) => notificationRecordService.getById(id)!.readAt !== null)).toBe(true)
      expect(notificationRecordService.getById(matching[0].id)!.readAt).toBe(originalReadAt)
      expect(notificationRecordService.unreadCount()).toBe(3)
      for (const record of [otherType, otherConversation, unrelated])
        expect(notificationRecordService.getById(record.id)!.readAt).toBeNull()
    }
  )

  it.each(['assistant', 'agent'] as const)(
    'omits all completion delivery while viewing the %s task',
    async (conversationType) => {
      mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
        type === WindowType.Main ? [mainWindowInfo({ isFocused: true })] : []
      )
      mocks.preferenceValues['app.notification.completion_sound.enabled'] = true
      mocks.isActiveInFocusedWindow.mockResolvedValue(true)
      const input = {
        eventKey: 'active-task',
        category: 'system' as const,
        kind: 'task-completion' as const,
        title: 'Done',
        message: 'Finished',
        createdAt: Date.now(),
        target: { kind: 'conversation' as const, conversationType, conversationId: 'conversation-1' }
      }
      await service.publish(input, { completion: true, source: 'assistant' })
      expect(notificationRecordService.list({}).items).toEqual([])
      expect(notificationRecordService.unreadCount()).toBe(0)
      expect(mocks.send).not.toHaveBeenCalled()
      expect(mocks.electronNotifications).toHaveLength(0)

      mocks.isActiveInFocusedWindow.mockResolvedValue(false)
      await service.publish(input, { completion: true, source: 'assistant' })
      expect(notificationRecordService.unreadCount()).toBe(1)
      expect(mocks.send.mock.calls.map(([, event]) => event)).toEqual([
        'notification.completion_sound',
        'notification.present'
      ])
    }
  )

  it('plays one completion chime and silences the OS notification across multiple windows', () => {
    mocks.preferenceValues['app.notification.completion_sound.enabled'] = true
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo()] : [mainWindowInfo({ id: 'sub-1', type })]
    )
    emitCompletion()
    expect(mocks.send.mock.calls.filter(([, event]) => event === 'notification.completion_sound')).toHaveLength(1)
    expect(mocks.electronNotifications[0].options).toMatchObject({ silent: true })
  })

  it('drops disabled categories and keeps persisted completion history if sound delivery fails', () => {
    mocks.preferenceValues['app.notification.center.system.enabled'] = false
    emitCompletion()
    expect(notificationRecordService.list({}).items).toEqual([])
    mocks.preferenceValues['app.notification.center.system.enabled'] = true
    mocks.preferenceValues['app.notification.completion_sound.enabled'] = true
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo()] : []
    )
    mocks.send.mockImplementation(() => {
      throw new Error('Renderer destroyed')
    })
    emitCompletion()
    expect(notificationRecordService.unreadCount()).toBe(1)
    expect(mocks.electronNotifications).toHaveLength(1)
  })

  it('marks a deleted target read but never opens a replacement conversation', async () => {
    emitCompletion()
    const [record] = notificationRecordService.list({}).items
    mocks.topicGetById.mockImplementation(() => {
      throw new Error('Missing topic')
    })
    await expect(service.activateNotification(record.id)).rejects.toThrow('notification.center.target_unavailable')
    expect(notificationRecordService.unreadCount()).toBe(0)
    expect(mocks.focusOrOpen).not.toHaveBeenCalled()
  })

  it.each(['dismissed', 'expired'])(
    'reports %s notifications as unavailable when clicked from a stale window',
    async (state) => {
      emitCompletion()
      const [record] = notificationRecordService.list({}).items
      if (state === 'dismissed') notificationRecordService.dismiss(record.id)
      else vi.spyOn(Date, 'now').mockReturnValue(record.createdAt + 31 * 24 * 60 * 60 * 1000)

      await expect(service.activateNotification(record.id)).rejects.toThrow('notification.center.target_unavailable')
      expect(mocks.focusOrOpen).not.toHaveBeenCalled()
    }
  )

  it('records a focused backup result without duplicating its existing foreground feedback', async () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo({ isFocused: true })] : []
    )
    await service.publish(
      {
        eventKey: 'backup-1',
        category: 'system',
        kind: 'backup-success',
        title: 'Backup complete',
        message: '',
        createdAt: Date.now()
      },
      { source: 'backup' }
    )
    expect(notificationRecordService.unreadCount()).toBe(1)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.electronNotifications).toHaveLength(0)
  })

  it('retries context history after a transient write failure and reports committed delivery separately', async () => {
    dbh.sqlite.exec(
      "CREATE TRIGGER fail_notification BEFORE INSERT ON notification_record BEGIN SELECT RAISE(ABORT, 'write failed'); END"
    )
    const usage = { topicId: 'topic-1', model: 'p::a', used: 900, max: 1000 }
    try {
      await service.observeContextUsage(usage)
      expect(notificationRecordService.unreadCount()).toBe(0)
    } finally {
      dbh.sqlite.exec('DROP TRIGGER fail_notification')
    }
    await service.observeContextUsage(usage)
    expect(notificationRecordService.unreadCount()).toBe(1)
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo({ isFocused: true })] : []
    )
    mocks.send.mockImplementation(() => {
      throw new Error('Renderer gone')
    })
    await expect(
      service.publish({
        eventKey: 'committed',
        category: 'usage',
        kind: 'daily-budget',
        title: '',
        message: '',
        createdAt: Date.now()
      })
    ).resolves.toBe(true)
    expect(notificationRecordService.unreadCount()).toBe(2)
  })

  it('warns once per context stage and model, persisting dedup across service restarts', async () => {
    const usage = { topicId: 'topic-1', model: 'p::m', used: 900, max: 1000, stage: 'initial' }
    await service.observeContextUsage(usage)
    await service.observeContextUsage(usage)
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(1)
    await service._doStop()
    BaseService.resetInstances()
    await initService()
    await service.observeContextUsage(usage)
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(1)
    await service.observeContextUsage({ ...usage, stage: 'compacted' })
    await service.observeContextUsage({ ...usage, model: 'p::new', stage: 'compacted' })
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(3)
  })

  it('does not re-alert alternating models in the same multi-model context stage', async () => {
    for (const model of ['p::a', 'p::b', 'p::a', 'p::b']) {
      await service.observeContextUsage({ topicId: 'topic-1', model, used: 900, max: 1000, stage: 'shared-stage' })
    }
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(2)
    service.resetContextUsage('topic-1')
    await service.observeContextUsage({ topicId: 'topic-1', model: 'p::a', used: 900, max: 1000 })
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(3)
  })

  it('retains a queued chat context warning when the following turn compacts below the threshold', async () => {
    const topicId = 'queued-context'
    const modelId = 'context-provider::model'
    dbh.db.insert(userProviderTable).values({ providerId: 'context-provider', name: 'Provider', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: modelId,
        providerId: 'context-provider',
        modelId: 'model',
        name: 'Model',
        capabilities: [],
        supportsStreaming: true,
        contextWindow: 1000,
        orderKey: 'a0'
      })
      .run()
    dbh.db.insert(topicTable).values({ id: topicId, name: 'Queued context', orderKey: 'a0' }).run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot(topicId, [
          { id: 'context-user', topicId, role: 'user', status: 'success', data: { parts: [] } },
          {
            id: 'context-first',
            parentId: 'context-user',
            topicId,
            role: 'assistant',
            status: 'pending',
            modelId,
            data: { parts: [] }
          },
          {
            id: 'context-next',
            parentId: 'context-first',
            topicId,
            role: 'assistant',
            status: 'pending',
            modelId,
            data: { parts: [] },
            compactionSummary: 'Compacted context'
          }
        ])
      )
      .run()
    const tokens = [950, 100]
    const originalGet = vi.mocked(application.get).getMockImplementation()!
    vi.mocked(application.get).mockImplementation(((name: string) =>
      name === 'AiService'
        ? {
            streamText: async () =>
              new ReadableStream({
                start(controller) {
                  controller.enqueue({ type: 'start', messageMetadata: { stats: { contextTokens: tokens.shift() } } })
                  controller.enqueue({ type: 'text-start', id: 'text' })
                  controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Completed' })
                  controller.enqueue({ type: 'text-end', id: 'text' })
                  controller.enqueue({ type: 'finish' })
                  controller.close()
                }
              })
          }
        : originalGet(name as never)) as typeof application.get)
    vi.spyOn(application, 'getExisting').mockImplementation((name: string) =>
      name === 'NotificationService' ? service : application.getContainer().getInstance(name)
    )
    const manager = new AiStreamManager()
    const completed: ConversationCompletedEvent[] = []
    manager.onConversationCompleted((event) => completed.push(event))
    const start = (messageId: string) =>
      manager.send({
        topicId,
        isPersistentConversation: true,
        models: [
          { modelId, request: { conversation: { id: topicId, topicId }, trigger: 'submit-message', messageId } }
        ],
        listeners: [
          new PersistenceListener({
            topicId,
            modelId,
            backend: new MessageServiceBackend({ assistantMessageId: messageId }),
            onPersistFailed: vi.fn()
          })
        ]
      })
    let warningsBeforeContinuation = 0
    vi.spyOn(manager, 'dispatch').mockImplementation(async () => {
      warningsBeforeContinuation = notificationRecordService.list({ category: 'usage' }).items.length
      start('context-next')
      return { mode: 'started' }
    })
    try {
      start('context-first')
      manager.enqueuePendingSteer(topicId, 'queued-user')
      await vi.waitFor(() => {
        expect(mocks.loggerError.mock.calls).toEqual([])
        expect(completed).toHaveLength(1)
      })
      expect(warningsBeforeContinuation).toBe(1)
      expect(notificationRecordService.list({ category: 'usage' }).items).toEqual([
        expect.objectContaining({
          kind: 'context-warning',
          target: { kind: 'conversation', conversationType: 'assistant', conversationId: topicId }
        })
      ])
    } finally {
      await manager._doStop()
      await manager._doDestroy()
    }
  })

  it('warns when committed usage crosses 80 percent once per local day without double-counting cache tokens', async () => {
    await service._doStop()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 12))
    BaseService.resetInstances()
    mocks.preferenceValues['app.notification.daily_budget.tokens'] = 100_000
    await initService()
    const record = (requestId: string, totalTokens: number) =>
      aiUsageRecordService.recordInvocation({
        requestId,
        context: createAiUsageCaptureContext({
          providerId: 'p',
          providerName: 'Provider',
          modelId: 'm',
          modelName: 'Model',
          pricingSnapshot: null,
          credentialReceipt: { attribution: 'unknown' },
          source: null,
          messageRef: null
        }),
        modality: 'language',
        usage: { totalTokens, cacheReadTokens: totalTokens },
        completedAt: Date.now()
      })
    record('before', 79_000)
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(0)
    record('crossing', 1_000)
    record('crossing', 1_000)
    record('after', 2_000)
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(1)
    await service._doStop()
    BaseService.resetInstances()
    await initService()
    record('after-restart', 2_000)
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(1)
    vi.setSystemTime(new Date(2026, 9, 16, 0, 1))
    record('next-day', 95_000)
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(2)
    expect(t).toHaveBeenCalledWith('notification.center.budget_message', {
      percent: 95,
      used: '95k',
      budget: '100k'
    })

    await service._doStop()
    BaseService.resetInstances()
    mocks.preferenceValues['app.notification.daily_budget.tokens'] = 1_000
    await initService()
    record('changed-budget', 100)
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(2)
  })

  it('sends one presentation-ready event to the focused full-chrome window', async () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main
        ? [mainWindowInfo()]
        : [
            mainWindowInfo({
              id: 'sub-1',
              type: WindowType.SubWindow,
              title: 'Detached chat',
              isVisible: true,
              isFocused: true
            })
          ]
    )

    emitCompletion()

    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce())
    expect(mocks.send).toHaveBeenCalledWith(
      'sub-1',
      'notification.present',
      expect.objectContaining({
        eventKey: 'task-completion:topic-1:turn-1',
        kind: 'task-completion',
        category: 'system',
        title: 'Assistant response complete',
        message: 'Research notes\nHere is the final answer.',
        target: { kind: 'conversation', conversationType: 'assistant', conversationId: 'topic-1' }
      })
    )
    expect(mocks.electronNotifications).toHaveLength(0)
  })

  it('sends a presentation-ready approval event to the focused full-chrome window', () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo({ isFocused: true })] : []
    )

    emitApproval()

    expect(mocks.send).toHaveBeenCalledWith('main-1', 'notification.conversation', {
      id: 'approval-request:approval-1',
      kind: 'approval-request',
      type: 'warning',
      title: 'Assistant needs your input',
      conversationName: 'Research notes',
      message: 'Research notes',
      timestamp: 200,
      actionKey: 'conversation.open',
      meta: { conversationType: 'assistant', conversationId: 'topic-1' },
      source: 'assistant'
    })
    expect(mocks.preferenceGet).not.toHaveBeenCalled()
    expect(mocks.electronNotifications).toHaveLength(0)
  })

  it('shows a main-owned Agent approval notification and delegates its click to conversation navigation', () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo()] : []
    )

    emitApproval(
      {
        topicId: 'agent-session:session-1',
        approvalId: 'approval-agent'
      },
      'agent'
    )

    expect(mocks.electronNotifications).toHaveLength(1)
    expect(mocks.electronNotifications[0].options).toEqual({
      title: 'Agent needs your input',
      body: 'Refactor project'
    })

    mocks.electronNotifications[0].click?.()
    expect(mocks.focusOrOpen).toHaveBeenCalledWith(
      { conversationType: 'agent', conversationId: 'session-1' },
      'Refactor project'
    )
    expect(mocks.broadcastToType).not.toHaveBeenCalled()
  })

  it('identifies Agent completion and includes its session and last response sentence', () => {
    emitCompletion({
      topicId: 'agent-session:session-1',
      responseText: 'I checked every call site. The refactor is complete.'
    })

    expect(mocks.electronNotifications[0].options).toEqual({
      title: 'Agent task complete',
      body: 'Refactor project\nThe refactor is complete.'
    })
    mocks.electronNotifications[0].click?.()
    expect(mocks.focusOrOpen).toHaveBeenCalledWith(
      { conversationType: 'agent', conversationId: 'session-1' },
      'Refactor project'
    )
  })

  it.each([
    ['已经定位问题。现在可以正常使用了！', '现在可以正常使用了！'],
    ['第一句。最后一句没有句末标点', '最后一句没有句末标点'],
    ['Checked the value. The result is 3.14.', 'The result is 3.14.'],
    ['First sentence! Are we done?', 'Are we done?'],
    ['前面的说明。\n\n最后一句。\n  ', '最后一句。'],
    ['处理完毕。他说：“可以发布了。”', '他说：“可以发布了。”'],
    ['Only one sentence', 'Only one sentence']
  ])('shows only the last sentence of %s', (responseText, expected) => {
    emitCompletion({ responseText })
    expect(mocks.electronNotifications[0].options).toEqual({
      title: 'Assistant response complete',
      body: `Research notes\n${expected}`
    })
  })

  it.each([
    ['topic-1', 'Assistant response complete'],
    ['agent-session:session-1', 'Agent task complete']
  ])('uses a generic completion title when %s has no name', (topicId, title) => {
    mocks.topicGetById.mockReturnValue({ name: '  ' })
    mocks.agentSessionGetById.mockReturnValue({ name: '' })
    emitCompletion({ topicId })
    expect(mocks.electronNotifications[0].options).toEqual({ title, body: 'Here is the final answer.' })
  })

  it.each([undefined, '', '   '])('falls back to the conversation name without reply text (%s)', (responseText) => {
    emitCompletion({ responseText })
    expect(mocks.electronNotifications[0].options.body).toBe('Research notes')
  })

  it('logs a name lookup failure and keeps notifying with the localized generic name', () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo()] : []
    )
    mocks.agentSessionGetById.mockImplementation(() => {
      throw new Error('missing')
    })

    emitCompletion({ topicId: 'agent-session:missing', responseText: undefined })

    expect(mocks.electronNotifications[0].options).toEqual({
      title: 'Agent task complete',
      body: 'Agent task complete'
    })
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Failed to resolve conversation name for notification',
      expect.objectContaining({ target: { conversationType: 'agent', conversationId: 'missing' } })
    )
  })

  it('does not notify in the background when the preference is disabled', () => {
    mocks.preferenceGet.mockReturnValue(false)
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo()] : []
    )
    emitApproval({ approvalId: 'approval-disabled' })
    expect(mocks.electronNotifications).toHaveLength(0)
  })

  it('notifies without a full-chrome window and delegates its click to cold-start navigation', () => {
    mocks.getWindowInfosByType.mockReturnValue([])

    emitCompletion({ turnId: 'turn-windowless' })

    expect(mocks.electronNotifications).toHaveLength(1)
    expect(mocks.electronNotifications[0].options).toEqual({
      title: 'Assistant response complete',
      body: 'Research notes\nHere is the final answer.'
    })

    mocks.electronNotifications[0].click?.()
    expect(mocks.focusOrOpen).toHaveBeenCalledWith(
      { conversationType: 'assistant', conversationId: 'topic-1' },
      'Research notes'
    )
  })

  it('preserves the existing click behavior for unrelated system notifications', async () => {
    const notification = {
      id: 'other',
      type: 'info' as const,
      title: 'Update',
      message: 'Ready',
      timestamp: 1,
      source: 'update' as const
    }
    await service.sendNotification(notification)

    mocks.electronNotifications[0].click?.()
    expect(mocks.showMainWindow).toHaveBeenCalledOnce()
    expect(mocks.broadcastToType).toHaveBeenCalledWith(WindowType.Main, 'notification.clicked', notification)
  })

  it('clears the Dock badge on init when every notification preference is already off', async () => {
    // Catches #20709 relaunch/init path: prefs already false, badge still shows "3".
    BaseService.resetInstances()
    for (const key of NOTIFICATION_PREF_KEYS) mocks.preferenceValues[key] = false
    mocks.setBadgeCount.mockClear()
    mocks.subscribeMultipleChanges.mockClear()

    await initService()

    expect(mocks.subscribeMultipleChanges).toHaveBeenCalledWith([...NOTIFICATION_PREF_KEYS], expect.any(Function))
    expect(mocks.setBadgeCount).toHaveBeenCalledWith(0)
  })

  it('clears the Dock badge when the last remaining notification preference is turned off', () => {
    // Catches #20709 settings path: turning off the final switch must clear a leftover badge.
    expect(notificationPrefListener).toBeTypeOf('function')

    for (const key of NOTIFICATION_PREF_KEYS.slice(0, -1)) mocks.preferenceValues[key] = false
    notificationPrefListener?.(NOTIFICATION_PREF_KEYS[0], false, true)
    expect(mocks.setBadgeCount).not.toHaveBeenCalled()

    const lastKey = NOTIFICATION_PREF_KEYS[NOTIFICATION_PREF_KEYS.length - 1]
    mocks.preferenceValues[lastKey] = false
    notificationPrefListener?.(lastKey, false, true)
    expect(mocks.setBadgeCount).toHaveBeenCalledWith(0)
  })

  it('does not clear the Dock badge while any notification preference remains enabled', () => {
    mocks.preferenceValues['app.notification.assistant.enabled'] = false
    notificationPrefListener?.('app.notification.assistant.enabled', false, true)
    expect(mocks.setBadgeCount).not.toHaveBeenCalled()
  })
})
