import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { notificationHandlers } from '@data/api/handlers/notifications'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'
import { agentTaskService } from '@data/services/AgentTaskService'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { notificationRecordService } from '@data/services/NotificationRecordService'
import { agentTaskJobHandler } from '@main/ai/agents/agentTaskJobHandler'
import { AiStreamManager, type ConversationCompletedEvent } from '@main/ai/streamManager'
import type { ApprovalRequestedEvent } from '@main/ai/types'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import { BaseService } from '@main/core/lifecycle'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { type WindowInfo, WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { NotificationRecordSchema, type TaskResultNotificationInput } from '@shared/data/types/notification'

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
  edition: vi.fn(() => 'global'),
  fetch: vi.fn<typeof fetch>(),
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
  net: { fetch: mocks.fetch },
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
vi.mock('@main/utils/appEdition', () => ({ getAppEdition: mocks.edition }))

const { NotificationService } = await import('../NotificationService')
const { OfficialAnnouncementService } = await import('../OfficialAnnouncementService')

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

function recordUsage(requestId: string, totalTokens: number): void {
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
}

function changeBudgetPreference(key: string, value: number | boolean): void {
  const previous = mocks.preferenceValues[key]
  mocks.preferenceValues[key] = value
  const subscription = mocks.subscribeMultipleChanges.mock.calls.findLast(([keys]) => keys.includes(key))
  subscription?.[1](key, value, previous)
}

describe('NotificationService', () => {
  const dbh = setupTestDatabase()
  let service: InstanceType<typeof NotificationService>
  let notificationPrefListener: ((key: string, newValue: boolean, oldValue: boolean) => void) | undefined

  async function initService(): Promise<void> {
    if (service) await service._doStop()
    BaseService.resetInstances()
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
          onConversationUnsuccessful: () => ({ dispose: vi.fn() }),
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

  describe('official announcement polling', () => {
    let announcements: InstanceType<typeof OfficialAnnouncementService>
    let scheduler: SchedulerService
    let preferenceChanged: () => void
    const interval = 30 * 60 * 1000
    const announcement = (id: string, published_at = '2026-10-28T01:00:00.000001Z') => ({
      id,
      published_at,
      title: `Announcement ${id}`,
      content: '**中文** 😀\n<b>plain text</b>',
      platforms: ['desktop'],
      products: ['global', 'cn']
    })
    const respond = (items = [announcement('one')], total = items.length) => Response.json({ items, total })
    const enable = (enabled: boolean) => {
      mocks.preferenceValues['app.notification.center.official.enabled'] = enabled
      preferenceChanged()
    }

    beforeEach(async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-28T02:00:00Z'))
      mocks.edition.mockReturnValue('global')
      mocks.fetch.mockReset().mockImplementation(async () => respond())
      scheduler = new SchedulerService()
      const get = vi.mocked(application.get).getMockImplementation()!
      vi.mocked(application.get).mockImplementation(((name: string) => {
        if (name === 'SchedulerService') return scheduler
        if (name === 'NotificationService') return service
        if (name === 'PreferenceService')
          return {
            ...get(name),
            subscribeChange: (_key: string, listener: () => void) => {
              preferenceChanged = listener
              return () => {
                preferenceChanged = () => {}
              }
            }
          }
        return get(name as never)
      }) as typeof application.get)
      announcements = new OfficialAnnouncementService()
      await announcements._doInit()
    })

    afterEach(async () => {
      await announcements._doStop()
      await scheduler._doStop()
      vi.clearAllTimers()
    })

    it.each(['global', 'cn'])(
      'requests the %s desktop feed after all-ready and polls after completion',
      async (edition) => {
        mocks.edition.mockReturnValue(edition)
        await vi.advanceTimersByTimeAsync(10_000)
        expect(mocks.fetch).not.toHaveBeenCalled()
        await announcements._doAllReady()
        await vi.advanceTimersByTimeAsync(4999)
        expect(notificationRecordService.unreadCount()).toBe(0)
        await vi.advanceTimersByTimeAsync(1)
        expect(mocks.fetch.mock.calls[0][0]).toBe(
          `https://api.cherry-ai.com/api/announcements?platform=desktop&product=${edition}&limit=100&offset=0`
        )
        expect(notificationRecordService.list({}).items[0]).toMatchObject({
          createdAt: Date.parse('2026-10-28T01:00:00Z'),
          readAt: null,
          message: '**中文** 😀 <b>plain text</b>',
          target: { content: announcement('one').content }
        })
        await vi.advanceTimersByTimeAsync(interval - 1)
        expect(mocks.fetch).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(mocks.fetch).toHaveBeenCalledTimes(2)
        expect(notificationRecordService.unreadCount()).toBe(1)
        expect(mocks.electronNotifications).toHaveLength(0)
      }
    )

    it('preserves read and dismissed versions across restart and distinguishes fractional republication', async () => {
      mocks.fetch.mockImplementation(async () => respond([announcement('read'), announcement('dismissed')]))
      await announcements._doAllReady()
      await vi.advanceTimersByTimeAsync(5000)
      const records = notificationRecordService.list({}).items
      const read = records.find((record) => record.title === 'Announcement read')!
      notificationRecordService.markRead(read.id)
      notificationRecordService.dismiss(records.find((record) => record.id !== read.id)!.id)
      await announcements._doStop()
      await announcements._doInit()
      await vi.advanceTimersByTimeAsync(5000)
      expect(notificationRecordService.list({}).items).toHaveLength(1)
      expect(notificationRecordService.unreadCount()).toBe(0)
      mocks.fetch.mockImplementation(async () => respond([announcement('read', '2026-10-28T01:00:00.000002Z')]))
      await vi.advanceTimersByTimeAsync(interval)
      expect(notificationRecordService.list({}).items).toHaveLength(2)
      expect(notificationRecordService.unreadCount()).toBe(1)
    })

    it('continues past duplicates and recovers offset shifts on the next complete poll', async () => {
      const first = Array.from({ length: 100 }, (_, index) => announcement(String(index)))
      mocks.fetch
        .mockImplementationOnce(async () => respond(first, 102))
        .mockImplementationOnce(async () => respond([first[99], announcement('tail')], 102))
      await announcements._doAllReady()
      await vi.advanceTimersByTimeAsync(5000)
      expect(notificationRecordService.unreadCount()).toBe(101)
      expect(new URL(String(mocks.fetch.mock.calls[1][0])).searchParams.get('offset')).toBe('100')
      mocks.fetch
        .mockImplementationOnce(async () => respond(first, 102))
        .mockImplementationOnce(async () => respond([announcement('missing'), announcement('tail')], 102))
      await vi.advanceTimersByTimeAsync(interval)
      expect(notificationRecordService.unreadCount()).toBe(102)
      mocks.fetch.mockImplementation(async () => respond([], 102))
      await vi.advanceTimersByTimeAsync(interval)
      expect(notificationRecordService.unreadCount()).toBe(102)
    })

    it('stops at the 30-day boundary and truncates summaries by code point without changing content', async () => {
      const cutoff = new Date(Date.now() + 5000 - 30 * 24 * 60 * 60 * 1000).toISOString()
      const content = `${'中'.repeat(239)}😀\n  **end**`
      mocks.fetch.mockImplementation(async () =>
        respond(
          [
            { ...announcement('recent'), content },
            announcement('boundary', cutoff),
            announcement('old', '2026-01-01T00:00:00Z')
          ],
          500
        )
      )
      await announcements._doAllReady()
      await vi.advanceTimersByTimeAsync(5000)
      expect(notificationRecordService.list({}).items).toEqual([
        expect.objectContaining({
          message: `${'中'.repeat(239)}😀`,
          target: { kind: 'announcement', content }
        })
      ])
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })

    it.each([
      [
        'network error',
        () => {
          throw new TypeError('Network request failed')
        }
      ],
      ['503', () => new Response('unavailable', { status: 503 })],
      ['invalid JSON', () => new Response('{')],
      ['null items', () => Response.json({ items: null, total: 1 })],
      ['invalid total', () => Response.json({ items: [], total: -1 })],
      ['invalid timestamp', () => respond([announcement('bad', '2026-02-30T00:00:00Z')])]
    ] as const)('retains history after %s and retries next round', async (_name, response) => {
      await announcements._doAllReady()
      await vi.advanceTimersByTimeAsync(5000)
      mocks.fetch.mockImplementationOnce(async () => response())
      await vi.advanceTimersByTimeAsync(interval)
      expect(notificationRecordService.unreadCount()).toBe(1)
      mocks.fetch.mockImplementationOnce(async () => respond([announcement('new')]))
      await vi.advanceTimersByTimeAsync(interval)
      expect(notificationRecordService.unreadCount()).toBe(2)
    })

    it('retries unwritten records after a partial persistence failure', async () => {
      const create = notificationRecordService.create.bind(notificationRecordService)
      vi.spyOn(notificationRecordService, 'create')
        .mockImplementationOnce(create)
        .mockImplementationOnce(() => {
          throw new Error('disk full')
        })
      mocks.fetch.mockImplementation(async () =>
        respond([announcement('one'), announcement('two'), announcement('three')])
      )
      await announcements._doAllReady()
      await vi.advanceTimersByTimeAsync(5000)
      expect(notificationRecordService.unreadCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(interval)
      expect(notificationRecordService.unreadCount()).toBe(3)
    })

    it('stays idle while disabled and leaves history untouched on an empty feed', async () => {
      enable(false)
      await announcements._doAllReady()
      await vi.advanceTimersByTimeAsync(interval)
      expect(mocks.fetch).not.toHaveBeenCalled()
      enable(true)
      await vi.advanceTimersByTimeAsync(5000)
      expect(notificationRecordService.unreadCount()).toBe(1)
      mocks.fetch.mockImplementation(async () => respond([], 0))
      await vi.advanceTimersByTimeAsync(interval)
      expect(notificationRecordService.unreadCount()).toBe(1)
      enable(false)
      await vi.advanceTimersByTimeAsync(interval)
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
    })

    it.each(['disable', 'stop'])('discards late responses after %s and keeps the new poll schedule', async (action) => {
      let resolve!: (response: Response) => void
      mocks.fetch.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      await announcements._doAllReady()
      await vi.advanceTimersByTimeAsync(5000)
      const signal = mocks.fetch.mock.calls[0][1]!.signal!
      if (action === 'stop') await announcements._doStop()
      else enable(false)
      expect(signal.aborted).toBe(true)
      if (action === 'stop') await announcements._doInit()
      else enable(true)
      resolve(respond([announcement('stale')]))
      await vi.advanceTimersByTimeAsync(0)
      expect(notificationRecordService.unreadCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(5000)
      expect(notificationRecordService.list({}).items.map((record) => record.title)).toEqual(['Announcement one'])
      await vi.advanceTimersByTimeAsync(interval)
      expect(mocks.fetch).toHaveBeenCalledTimes(3)
    })

    it('times out a stalled response body and waits 30 minutes after failure before retrying', async () => {
      vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
        const controller = new AbortController()
        setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms)
        return controller.signal
      })
      mocks.fetch.mockImplementationOnce(
        async (_url, options) =>
          ({
            ok: true,
            json: () =>
              new Promise((_resolve, reject) =>
                options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason))
              )
          }) as Response
      )
      await announcements._doAllReady()
      await vi.advanceTimersByTimeAsync(5000 + 14_999)
      expect(notificationRecordService.unreadCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(1 + interval - 1)
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(notificationRecordService.unreadCount()).toBe(1)
    })
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

  const taskResult = (overrides: Partial<TaskResultNotificationInput> = {}): TaskResultNotificationInput => ({
    resultId: 'run-1',
    source: 'agent',
    status: 'succeeded',
    name: 'Snapshot name',
    finishedAt: Date.now(),
    target: { kind: 'conversation', conversationType: 'agent', conversationId: 'session-1', messageId: 'message-1' },
    ...overrides
  })

  // A foreground outcome must never briefly add an unread badge or emit a success sound on failure.
  it.each(['succeeded', 'failed', 'interrupted', 'cancelled'] as const)(
    'applies the %s policy atomically in foreground and background',
    async (status) => {
      let active = false
      mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
        type === WindowType.Main ? [mainWindowInfo({ isFocused: active })] : []
      )
      mocks.isActiveInFocusedWindow.mockImplementation(async () => active)
      mocks.preferenceValues['app.notification.completion_sound.enabled'] = true
      for (active of [false, true]) {
        const previous = notificationRecordService.unreadCount()
        mocks.send.mockClear()
        mocks.electronNotifications.length = 0
        const input = taskResult({ status, resultId: `run-${active}` })
        expect(await service.publishTaskResult(input)).toBe(true)
        const silent = active || status === 'cancelled'
        expect(notificationRecordService.unreadCount()).toBe(previous + (silent ? 0 : 1))
        const record = notificationRecordService.list().items.find((item) => item.eventKey.includes(input.resultId))
        if (active && status === 'succeeded') expect(record).toBeUndefined()
        else expect(record?.readAt !== null).toBe(silent)
        expect(mocks.electronNotifications).toHaveLength(silent ? 0 : 1)
        expect(mocks.send.mock.calls.filter(([, event]) => event === 'notification.completion_sound')).toHaveLength(
          !silent && status === 'succeeded' ? 1 : 0
        )
        expect(mocks.send.mock.calls.filter(([, event]) => event === 'notification.present')).toHaveLength(0)
      }
    }
  )

  it('presents a background task error in another focused conversation without a success sound', async () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo({ isFocused: true })] : []
    )
    mocks.preferenceValues['app.notification.completion_sound.enabled'] = true
    await service.publishTaskResult(
      taskResult({
        status: 'failed',
        actor: { name: 'Saved agent', emoji: '🤖' },
        durationMs: 500,
        errorSummary: 'Authorization: Bearer secret-value'
      })
    )
    const record = notificationRecordService.list().items[0]
    const saved = NotificationRecordSchema.parse(
      await notificationHandlers['/notifications/:id'].GET({ params: { id: record.id } })
    )
    expect(saved.target).toMatchObject({
      messageId: 'message-1',
      result: { status: 'failed', durationMs: 500, actor: { name: 'Saved agent', emoji: '🤖' } }
    })
    expect(saved.target?.result?.errorSummary).not.toContain('secret-value')
    expect(await notificationHandlers['/notifications'].GET({ query: {} })).toMatchObject({ items: [saved] })
    expect(record.message).not.toContain('secret-value')
    expect(mocks.send.mock.calls.filter(([, event]) => event === 'notification.present')).toEqual([
      ['main-1', 'notification.present', record]
    ])
    expect(mocks.send.mock.calls.some(([, event]) => event === 'notification.completion_sound')).toBe(false)
  })

  it('consumes concurrent duplicates durably across restart, dismissal and history expiry', async () => {
    const input = taskResult()
    expect(await Promise.all(Array.from({ length: 8 }, () => service.publishTaskResult(input)))).toEqual(
      Array(8).fill(true)
    )
    expect(notificationRecordService.list().items).toHaveLength(1)
    expect(mocks.electronNotifications).toHaveLength(1)
    const record = notificationRecordService.list().items[0]
    notificationRecordService.markRead(record.id)
    await initService()
    await service.publishTaskResult(input)
    expect(notificationRecordService.unreadCount()).toBe(0)
    notificationRecordService.dismiss(record.id)
    await service.publishTaskResult(input)
    notificationRecordService.purgeExpired(Date.now() + 31 * 86400_000)
    await initService()
    await service.publishTaskResult(input)
    expect(notificationRecordService.list().items).toEqual([])
    expect(mocks.electronNotifications).toHaveLength(1)
  })

  it('consumes disabled, active-success and already-expired outcomes without replaying them later', async () => {
    mocks.preferenceValues['app.notification.center.system.enabled'] = false
    await service.publishTaskResult(taskResult({ resultId: 'disabled' }))
    mocks.preferenceValues['app.notification.center.system.enabled'] = true
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo({ isFocused: true })] : []
    )
    mocks.isActiveInFocusedWindow.mockResolvedValue(true)
    await service.publishTaskResult(taskResult({ resultId: 'active' }))
    await service.publishTaskResult(
      taskResult({ resultId: 'old', status: 'failed', finishedAt: Date.now() - 31 * 86400_000 })
    )
    mocks.getWindowInfosByType.mockReturnValue([])
    await initService()
    for (const resultId of ['disabled', 'active', 'old']) await service.publishTaskResult(taskResult({ resultId }))
    expect(notificationRecordService.list().items).toEqual([])
    expect(mocks.electronNotifications).toHaveLength(0)
  })

  it('rolls back the consumption marker on a failed insert and retries exactly once', async () => {
    const input = taskResult()
    dbh.sqlite.exec(
      "CREATE TRIGGER reject_result BEFORE INSERT ON notification_record BEGIN SELECT RAISE(ABORT, 'write failure'); END"
    )
    try {
      expect(await service.publishTaskResult(input)).toBe(false)
      expect(dbh.sqlite.prepare("SELECT key FROM app_state WHERE key LIKE 'notification:consumed:%'").all()).toEqual([])
      expect(notificationRecordService.unreadCount()).toBe(0)
    } finally {
      dbh.sqlite.exec('DROP TRIGGER reject_result')
    }
    expect(await service.publishTaskResult(input)).toBe(true)
    expect(await service.publishTaskResult(input)).toBe(true)
    expect(notificationRecordService.unreadCount()).toBe(1)
    expect(mocks.electronNotifications).toHaveLength(1)
  })

  it('opens a stored message anchor, and leaves a deleted target readable and dismissible', async () => {
    await service.publishTaskResult(taskResult())
    const record = notificationRecordService.list().items[0]
    await service.activateNotification(record.id)
    expect(mocks.focusOrOpen).toHaveBeenLastCalledWith(
      { conversationType: 'agent', conversationId: 'session-1' },
      'Refactor project',
      null,
      'message-1'
    )
    mocks.agentSessionGetById.mockImplementation(() => {
      throw new Error('deleted')
    })
    await expect(service.activateNotification(record.id)).rejects.toThrow('notification.center.target_unavailable')
    expect(notificationRecordService.getById(record.id)?.readAt).not.toBeNull()
    notificationRecordService.dismiss(record.id)
    expect(notificationRecordService.getById(record.id)).toBeNull()
  })

  it('records a scheduled failure without a conversation and rejects a deleted schedule', async () => {
    await service.publishTaskResult(
      taskResult({
        source: 'scheduled-task',
        status: 'failed',
        target: { kind: 'scheduled-task', taskId: 'deleted' },
        errorSummary: 'Failed before creating a session'
      })
    )
    const record = notificationRecordService.list().items[0]
    expect(record.target?.result?.errorSummary).toBe('Failed before creating a session')
    const lookup = vi.spyOn(agentTaskService, 'getTaskById').mockReturnValue(null)
    await expect(service.activateNotification(record.id)).rejects.toThrow('notification.center.target_unavailable')
    expect(lookup).toHaveBeenCalledWith('deleted')
    expect(mocks.focusOrOpen).not.toHaveBeenCalled()
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
      const target = {
        kind: 'conversation' as const,
        conversationType,
        conversationId: 'shared-id',
        result: { source: conversationType, status: 'succeeded' as const, name: 'Saved task' }
      }
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

  it.each([
    ['assistant', 1],
    ['agent', 1],
    ['assistant', 3],
    ['agent', 3]
  ] as const)(
    'omits all completion delivery while viewing the %s batch of %i tasks',
    async (conversationType, completedTaskCount) => {
      mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
        type === WindowType.Main ? [mainWindowInfo({ isFocused: true })] : []
      )
      mocks.preferenceValues['app.notification.completion_sound.enabled'] = true
      mocks.isActiveInFocusedWindow.mockResolvedValue(true)
      const publish = vi.spyOn(service, 'publish')
      const completion = {
        topicId: conversationType === 'agent' ? 'agent-session:conversation-1' : 'conversation-1',
        completedTaskCount
      }
      emitCompletion(completion)
      await publish.mock.results[0].value
      expect(notificationRecordService.list({}).items).toEqual([])
      expect(notificationRecordService.unreadCount()).toBe(0)
      expect(mocks.send).not.toHaveBeenCalled()
      expect(mocks.electronNotifications).toHaveLength(0)

      mocks.isActiveInFocusedWindow.mockResolvedValue(false)
      emitCompletion(completion)
      await publish.mock.results[1].value
      expect(notificationRecordService.unreadCount()).toBe(1)
      expect(notificationRecordService.list({}).items[0].kind).toBe(
        completedTaskCount > 1 ? 'queue-completion' : 'task-completion'
      )
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

  it('retries failed history writes and preserves committed notifications when delivery fails', async () => {
    dbh.sqlite.exec(
      "CREATE TRIGGER fail_notification BEFORE INSERT ON notification_record BEGIN SELECT RAISE(ABORT, 'write failed'); END"
    )
    const input = {
      eventKey: 'budget-retry',
      category: 'usage' as const,
      kind: 'daily-budget',
      title: 'Daily budget',
      message: '80% used',
      createdAt: Date.now()
    }
    try {
      await expect(service.publish(input)).resolves.toBe(false)
      expect(notificationRecordService.unreadCount()).toBe(0)
    } finally {
      dbh.sqlite.exec('DROP TRIGGER fail_notification')
    }
    await expect(service.publish(input)).resolves.toBe(true)
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

  it.each(['read', 'dismissed'] as const)(
    'retains a %s budget reminder across restart without replay',
    async (state) => {
      mocks.preferenceValues['app.notification.daily_budget.tokens'] = 100_000
      recordUsage('crossing', 80_000)
      await vi.waitFor(() => expect(notificationRecordService.unreadCount()).toBe(1))
      const [record] = notificationRecordService.list({ category: 'usage' }).items
      notificationRecordService.markRead(record.id)
      const readAt = notificationRecordService.getById(record.id)!.readAt
      if (state === 'dismissed') notificationRecordService.dismiss(record.id)
      await service._doStop()
      BaseService.resetInstances()
      await initService()
      mocks.electronNotifications.length = 0
      recordUsage('after-restart', 1_000)
      await Promise.resolve()
      expect(notificationRecordService.unreadCount()).toBe(0)
      expect(notificationRecordService.list({ category: 'usage' }).items).toEqual(
        state === 'dismissed' ? [] : [{ ...record, readAt }]
      )
      expect(mocks.electronNotifications).toHaveLength(0)
    }
  )

  it.each([
    ['topic-failure', '403 用户额度不足', false],
    ['agent-session:quota-failure', '403 用户额度不足', false],
    ['agent-session:foreground-failure', '403 用户额度不足', true],
    ['topic-auth', '401 Invalid API key', false],
    ['topic-rate-limit', '429 Too many requests', false],
    ['topic-network', 'ECONNRESET connection lost', false],
    ['topic-context', 'maximum context length exceeded', false],
    ['topic-server', '503 Service unavailable', false]
  ])('records a terminal failure from the real stream manager: %s', async (topicId, message, active) => {
    mocks.isActiveInFocusedWindow.mockResolvedValue(active)
    mocks.getWindowInfosByType.mockReturnValue(active ? [mainWindowInfo({ isFocused: true })] : [])
    const manager = new AiStreamManager({ gracePeriodMs: 1 })
    const originalGet = vi.mocked(application.get).getMockImplementation()!
    vi.mocked(application.get).mockImplementation(((name: string) => {
      if (name === 'AiStreamManager') return manager
      if (name === 'AiService')
        return {
          streamText: async () => {
            throw new Error(message)
          }
        }
      return originalGet(name as never)
    }) as typeof application.get)
    await initService()
    try {
      manager.send({
        topicId,
        isPersistentConversation: true,
        models: [
          {
            modelId: 'provider::model',
            request: {
              conversation: { id: topicId, topicId },
              trigger: 'submit-message',
              messageId: 'failed-answer'
            }
          }
        ],
        listeners: []
      })
      await vi.waitFor(() => expect(notificationRecordService.list({}).items).toHaveLength(1))
      expect(notificationRecordService.list({}).items[0]).toMatchObject({
        kind: 'task-result',
        readAt: active ? expect.any(Number) : null,
        target: {
          kind: 'conversation',
          messageId: 'failed-answer',
          result: {
            status: 'failed',
            errorSummary: expect.any(String)
          }
        }
      })
    } finally {
      await manager._doStop()
      await manager._doDestroy()
    }
  })

  it.each([
    ['failed', false, {}, 'failed'],
    ['cancelled', true, {}, 'cancelled'],
    ['cancelled', false, {}, 'interrupted'],
    ['failed', false, { taskResultStatus: 'interrupted' }, 'interrupted'],
    ['failed', false, { taskResultStatus: 'cancelled' }, 'cancelled']
  ] as const)(
    'records settled scheduled jobs once: %s / %j / %j',
    async (status, cancelRequested, metadata, expected) => {
      const now = Date.now()
      dbh.db
        .insert(jobScheduleTable)
        .values({
          id: 'schedule-result',
          type: 'agent.task',
          name: 'Daily check',
          trigger: { kind: 'interval', ms: 60000 },
          jobInputTemplate: {},
          catchUpPolicy: { kind: 'skip-missed' }
        })
        .run()
      dbh.db
        .insert(jobTable)
        .values({
          id: 'job-result',
          type: 'agent.task',
          status,
          queue: 'agent:a',
          scheduleId: 'schedule-result',
          scheduledAt: now - 1000,
          finishedAt: now,
          input: {},
          cancelRequested,
          metadata,
          error: { code: 'JOB_HANDLER_THREW', message: '403 用户额度不足', retryable: false }
        })
        .run()
      const originalGet = vi.mocked(application.get).getMockImplementation()!
      vi.mocked(application.get).mockImplementation((name) =>
        name === 'NotificationService' ? service : originalGet(name)
      )
      const event = {
        jobId: 'job-result',
        scheduleId: 'schedule-result',
        type: 'agent.task',
        status,
        parentId: null,
        attempt: 0,
        input: { agentId: 'a', prompt: 'test', timeoutMinutes: 1, reuseRevision: 0 },
        error: null,
        metadata
      }
      await agentTaskJobHandler.onSettled?.(event)
      await agentTaskJobHandler.onSettled?.(event)
      expect(notificationRecordService.list({}).items).toHaveLength(1)
      expect(notificationRecordService.list({}).items[0]).toMatchObject({
        readAt: expected === 'cancelled' ? expect.any(Number) : null,
        target: {
          kind: 'scheduled-task',
          taskId: 'schedule-result',
          result: { source: 'scheduled-task', status: expected }
        }
      })
      expect(notificationRecordService.list({}).items[0].target?.result).not.toHaveProperty('durationMs')
    }
  )

  it('warns when committed usage crosses 80 percent once per local day without double-counting cache tokens', async () => {
    await service._doStop()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 12))
    BaseService.resetInstances()
    mocks.preferenceValues['app.notification.daily_budget.tokens'] = 100_000
    await initService()
    recordUsage('before', 79_000)
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(0)
    recordUsage('crossing', 1_000)
    recordUsage('crossing', 1_000)
    recordUsage('after', 2_000)
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(1)
    await service._doStop()
    BaseService.resetInstances()
    await initService()
    recordUsage('after-restart', 2_000)
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(1)
    vi.setSystemTime(new Date(2026, 9, 16, 0, 1))
    recordUsage('next-day', 95_000)
    expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(2)
    expect(t).toHaveBeenCalledWith('notification.center.budget_message', {
      percent: 95,
      used: '95k',
      budget: '100k'
    })
  })

  it.each([
    ['budget enabled', 'app.notification.daily_budget.tokens', 0, 100_000],
    ['budget lowered', 'app.notification.daily_budget.tokens', 200_000, 100_000],
    ['threshold lowered', 'app.notification.daily_budget.threshold', 100, 80],
    ['usage enabled', 'app.notification.center.usage.enabled', false, true],
    ['service restarted', 'app.notification.daily_budget.tokens', 0, 100_000]
  ] as const)(
    'warns on the next committed usage when already over the limit after %s',
    async (scenario, key, before, after) => {
      mocks.preferenceValues['app.notification.daily_budget.tokens'] = 100_000
      mocks.preferenceValues[key] = before
      await initService()
      recordUsage('existing', 90_000)
      changeBudgetPreference(key, after)
      if (scenario === 'service restarted') await initService()
      expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(0)

      mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
        type === WindowType.Main ? [mainWindowInfo({ isFocused: true })] : []
      )
      recordUsage('new', 1_000)
      await Promise.resolve()
      recordUsage('more', 1_000)
      expect(notificationRecordService.list({ category: 'usage' }).items).toEqual([
        expect.objectContaining({ kind: 'daily-budget', target: { kind: 'settings', tab: 'usage' } })
      ])
      expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
        'main-1',
        'notification.present',
        expect.objectContaining({ kind: 'daily-budget' })
      )
    }
  )

  it.each([
    ['app.notification.daily_budget.tokens', 100_000, 200_000],
    ['app.notification.daily_budget.threshold', 80, 100]
  ] as const)(
    'rearms the daily warning after changing %s, including returning to an earlier value',
    async (key, initial, changed) => {
      mocks.preferenceValues['app.notification.daily_budget.tokens'] = 100_000
      await initService()
      recordUsage('initial-warning', 90_000)
      const [first] = notificationRecordService.list({ category: 'usage' }).items
      expect(first?.kind).toBe('daily-budget')
      notificationRecordService.dismiss(first.id)
      await Promise.resolve()

      changeBudgetPreference(key, changed)
      await initService()
      recordUsage('below-new-limit', 1_000)
      expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(0)
      recordUsage('new-limit-crossed', 80_000)
      await Promise.resolve()
      expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(1)
      await initService()
      changeBudgetPreference(key, changed)
      recordUsage('same-limit', 1_000)
      expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(1)

      changeBudgetPreference(key, initial)
      expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(1)
      recordUsage('returned-limit', 1_000)
      await Promise.resolve()
      recordUsage('same-day-more', 1_000)
      expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(2)
    }
  )

  it('retries the daily budget reminder on later usage after a failed notification write', async () => {
    mocks.preferenceValues['app.notification.daily_budget.tokens'] = 100_000
    await initService()
    dbh.sqlite.exec(
      "CREATE TRIGGER fail_budget_notification BEFORE INSERT ON notification_record BEGIN SELECT RAISE(ABORT, 'write failed'); END"
    )
    try {
      recordUsage('crossing', 90_000)
      await Promise.resolve()
      expect(notificationRecordService.list({ category: 'usage' }).items).toHaveLength(0)
    } finally {
      dbh.sqlite.exec('DROP TRIGGER fail_budget_notification')
    }
    recordUsage('retry', 1_000)
    expect(notificationRecordService.list({ category: 'usage' }).items).toEqual([
      expect.objectContaining({ kind: 'daily-budget' })
    ])
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
      'Refactor project',
      null,
      undefined
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
      'Research notes',
      null,
      undefined
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

// Results must coexist with old history using only the prerequisite's production schema.
describe('notification result storage compatibility', () => {
  const dbh = setupTestDatabase({ migrationsThrough: '0030_notification_record' })
  it.each([
    null,
    { kind: 'conversation' as const, conversationType: 'assistant' as const, conversationId: 'old-topic' }
  ])('preserves old history and adds results without upgrading the database (%j)', (target) => {
    const id = crypto.randomUUID()
    dbh.sqlite
      .prepare(
        'INSERT INTO notification_record (id, event_key, category, kind, title, message, created_at, target) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        'legacy',
        'system',
        'task-completion',
        'Existing',
        'History',
        Date.now(),
        target && JSON.stringify(target)
      )
    const result = { source: 'agent' as const, status: 'failed' as const, name: 'New task' }
    const created = notificationRecordService.consumeTaskResult('new-result', {
      eventKey: 'new-result',
      category: 'system',
      kind: 'task-result',
      title: 'Failed',
      message: 'New task',
      createdAt: Date.now(),
      target: { kind: 'conversation', conversationType: 'agent', conversationId: 'new-session', result }
    })!
    expect(NotificationRecordSchema.parse(notificationRecordService.getById(id))).toMatchObject({
      title: 'Existing',
      readAt: null,
      target
    })
    expect(NotificationRecordSchema.parse(notificationRecordService.getById(created.id)).target?.result).toEqual(result)
    expect(notificationRecordService.unreadCount()).toBe(2)
    expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
