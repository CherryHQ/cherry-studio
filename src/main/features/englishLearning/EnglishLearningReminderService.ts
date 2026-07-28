import { application } from '@application'
import { reviewService } from '@data/services/ReviewService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import { openRouteInMainWindow } from '@main/services/mainWindowNavigation'
import { Notification } from 'electron'

import { isInsideQuietHours, localDayKey, minutesOfDay } from './reminderTime'

const logger = loggerService.withContext('EnglishLearningReminderService')
const REMINDER_POLL_INTERVAL_MS = 30_000
const REVIEW_ROUTE = '/app/english-learning/review'

@Injectable('EnglishLearningReminderService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['TrayService'])
export class EnglishLearningReminderService extends BaseService {
  private lastNotifiedDay: string | null = null
  private notification: Notification | null = null

  protected onInit(): void {
    this.ensureTrayResidence()
    this.registerInterval(async () => {
      await this.checkDueReview()
    }, REMINDER_POLL_INTERVAL_MS)
  }

  protected onAllReady(): void {
    void this.checkDueReview()
  }

  protected onStop(): void {
    this.notification?.close()
    this.notification = null
  }

  openToday(): void {
    openRouteInMainWindow(REVIEW_ROUTE)
  }

  async snooze(minutes?: number): Promise<{ snoozedUntil: string }> {
    const preferenceService = application.get('PreferenceService')
    const duration = minutes ?? preferenceService.get('feature.english_learning.snooze_minutes')
    const snoozedUntil = new Date(Date.now() + duration * 60_000).toISOString()
    await preferenceService.set('feature.english_learning.snoozed_until', snoozedUntil)
    this.lastNotifiedDay = null
    this.notification?.close()
    this.notification = null
    logger.info('English review reminder snoozed', { snoozedUntil })
    return { snoozedUntil }
  }

  async checkDueReview(now = new Date()): Promise<boolean> {
    const preferenceService = application.get('PreferenceService')
    if (!preferenceService.get('feature.english_learning.enabled')) return false

    const reviewTime = minutesOfDay(preferenceService.get('feature.english_learning.review_time'))
    const quietStart = minutesOfDay(preferenceService.get('feature.english_learning.quiet_hours_start'))
    const quietEnd = minutesOfDay(preferenceService.get('feature.english_learning.quiet_hours_end'))
    if (reviewTime === null || quietStart === null || quietEnd === null) {
      logger.warn('Skipping English review reminder because a configured time is invalid')
      return false
    }

    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const dayKey = localDayKey(now)
    if (nowMinutes < reviewTime || isInsideQuietHours(nowMinutes, quietStart, quietEnd)) return false
    if (this.lastNotifiedDay === dayKey) return false

    const snoozedUntil = preferenceService.get('feature.english_learning.snoozed_until')
    if (snoozedUntil) {
      const snoozeTime = Date.parse(snoozedUntil)
      if (Number.isFinite(snoozeTime) && now.getTime() < snoozeTime) return false
      await preferenceService.set('feature.english_learning.snoozed_until', null)
    }

    const queue = reviewService.getDailyQueue({ now, limit: 1 })
    if (queue.items.length === 0) return false

    this.showNotification(queue.dueTotal)
    this.lastNotifiedDay = dayKey
    return true
  }

  private showNotification(cardCount: number): void {
    if (!Notification.isSupported()) {
      logger.warn('System notifications are unavailable for English review reminders')
      return
    }

    this.notification?.close()
    const notification = new Notification({
      title: t('english_learning.reminder.title'),
      body: t('english_learning.reminder.body', { count: cardCount }),
      actions: [{ type: 'button', text: t('english_learning.reminder.snooze') }]
    })
    notification.on('click', () => this.openToday())
    notification.on('action', ({ actionIndex }) => {
      if (actionIndex === 0) void this.snooze()
    })
    notification.on('close', () => {
      if (this.notification === notification) this.notification = null
    })
    notification.show()
    this.notification = notification
  }

  private ensureTrayResidence(): void {
    const preferenceService = application.get('PreferenceService')
    if (!preferenceService.get('feature.english_learning.enabled')) return
    if (!preferenceService.get('app.tray.enabled')) void preferenceService.set('app.tray.enabled', true)
    if (!preferenceService.get('app.tray.on_close')) void preferenceService.set('app.tray.on_close', true)
  }
}
