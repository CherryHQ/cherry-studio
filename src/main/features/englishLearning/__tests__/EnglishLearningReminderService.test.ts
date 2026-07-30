import { BaseService } from '@main/core/lifecycle'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  applicationGetMock,
  MockNotification,
  notificationInstances,
  openRouteInMainWindowMock,
  preferences,
  reviewGetDailyQueueMock,
  setPreferenceMock
} = vi.hoisted(() => {
  const preferences = new Map<string, unknown>()
  const notificationInstances: any[] = []
  const setPreferenceMock = vi.fn(async (key: string, value: unknown) => {
    preferences.set(key, value)
  })
  const applicationGetMock = vi.fn((serviceName: string) => {
    if (serviceName === 'PreferenceService') {
      return {
        get: (key: string) => preferences.get(key),
        set: setPreferenceMock
      }
    }
    throw new Error(`Unexpected service: ${serviceName}`)
  })
  class MockNotification {
    static isSupported = vi.fn(() => true)

    readonly handlers = new Map<string, NotificationHandler>()
    readonly options: unknown
    readonly show = vi.fn()
    readonly close = vi.fn(() => this.handlers.get('close')?.())

    constructor(options: unknown) {
      this.options = options
      notificationInstances.push(this)
    }

    on(eventName: string, handler: NotificationHandler): this {
      this.handlers.set(eventName, handler)
      return this
    }
  }

  return {
    applicationGetMock,
    MockNotification,
    notificationInstances,
    openRouteInMainWindowMock: vi.fn(),
    preferences,
    reviewGetDailyQueueMock: vi.fn(),
    setPreferenceMock
  }
})

type NotificationHandler = (...args: any[]) => void

vi.mock('@application', () => ({ application: { get: applicationGetMock } }))
vi.mock('@data/services/ReviewService', () => ({ reviewService: { getDailyQueue: reviewGetDailyQueueMock } }))
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))
vi.mock('@main/i18n', () => ({ t: (key: string, params?: { count?: number }) => `${key}:${params?.count ?? ''}` }))
vi.mock('@main/services/mainWindowNavigation', () => ({ openRouteInMainWindow: openRouteInMainWindowMock }))
vi.mock('electron', () => ({
  Notification: MockNotification,
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeListener: vi.fn()
  }
}))

async function createService() {
  const { EnglishLearningReminderService } = await import('../EnglishLearningReminderService')
  return new EnglishLearningReminderService()
}

describe('EnglishLearningReminderService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    preferences.clear()
    preferences.set('feature.english_learning.enabled', true)
    preferences.set('feature.english_learning.review_time', '09:00')
    preferences.set('feature.english_learning.quiet_hours_start', '23:00')
    preferences.set('feature.english_learning.quiet_hours_end', '07:00')
    preferences.set('feature.english_learning.snooze_minutes', 30)
    preferences.set('feature.english_learning.snoozed_until', null)
    preferences.set('app.tray.enabled', false)
    preferences.set('app.tray.on_close', false)
    applicationGetMock.mockClear()
    notificationInstances.length = 0
    openRouteInMainWindowMock.mockClear()
    reviewGetDailyQueueMock.mockReset()
    setPreferenceMock.mockClear()
    MockNotification.isSupported.mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enables tray residence when initialized for background reminders', async () => {
    const service = await createService()

    await service._doInit()
    await service._doStop()

    expect(setPreferenceMock).toHaveBeenCalledWith('app.tray.enabled', true)
    expect(setPreferenceMock).toHaveBeenCalledWith('app.tray.on_close', true)
  })

  it('shows one due notification and opens today review on click', async () => {
    const service = await createService()
    reviewGetDailyQueueMock.mockReturnValue({ items: [{}], dueTotal: 7 })

    const shown = await service.checkDueReview(new Date(2026, 6, 30, 9, 0))

    expect(shown).toBe(true)
    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].options).toMatchObject({
      title: 'english_learning.reminder.title:',
      body: 'english_learning.reminder.body:7'
    })

    notificationInstances[0].handlers.get('click')?.()

    expect(openRouteInMainWindowMock).toHaveBeenCalledWith('/app/english-learning/review')
    expect(await service.checkDueReview(new Date(2026, 6, 30, 9, 1))).toBe(false)
  })

  it('snoozes from the notification action and suppresses reminders until the snooze expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 30, 9, 0))
    const service = await createService()
    reviewGetDailyQueueMock.mockReturnValue({ items: [{}], dueTotal: 3 })

    await service.checkDueReview(new Date(2026, 6, 30, 9, 0))
    notificationInstances[0].handlers.get('action')?.({ actionIndex: 0 })
    await vi.runAllTimersAsync()

    expect(setPreferenceMock).toHaveBeenCalledWith(
      'feature.english_learning.snoozed_until',
      new Date(2026, 6, 30, 9, 30).toISOString()
    )
    expect(await service.checkDueReview(new Date(2026, 6, 30, 9, 10))).toBe(false)
    expect(await service.checkDueReview(new Date(2026, 6, 30, 9, 31))).toBe(true)
  })
})
