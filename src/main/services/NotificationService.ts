import { app, nativeImage, Notification as ElectronNotification } from 'electron'

import { application } from '@application'
import { type CreateNotificationRecordInput, notificationRecordService } from '@data/services/NotificationRecordService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import { renderTaskbarBadgeBitmap } from '@main/utils/taskbarBadgeIcon'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { NotificationTaskResultSchema, type TaskResultNotificationInput } from '@shared/data/types/notification'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import {
  CONVERSATION_NOTIFICATION_ACTION_KEY,
  type ConversationNotification,
  type Notification,
  type NotificationSource
} from '@shared/types/notification'
import { redactSecretText, redactSecretTokens } from '@shared/utils/redaction'

import { activateNotification, resolveNotificationConversationName } from './notificationActivation'

const logger = loggerService.withContext('NotificationService')

/** OS notification category gates — all off means the Dock badge must clear (#20709). */
const OS_NOTIFICATION_PREF_KEYS = [
  'app.notification.assistant.enabled',
  'app.notification.backup.enabled',
  'app.notification.knowledge.enabled',
  'app.notification.update.enabled',
  'app.notification.mini_app.enabled',
  'app.notification.usage.os.enabled'
] as const satisfies readonly UnifiedPreferenceKeyType[]

const TASKBAR_BADGE_PREF_KEY = 'app.notification.taskbar_badge.enabled'

function conversationKey(target: ConversationNavigationTarget): string {
  return `${target.conversationType}:${target.conversationId}`
}

function isConversationTarget(meta: unknown): meta is ConversationNavigationTarget {
  if (!meta || typeof meta !== 'object') return false

  const candidate = meta as Partial<ConversationNavigationTarget>
  return (
    (candidate.conversationType === 'assistant' || candidate.conversationType === 'agent') &&
    typeof candidate.conversationId === 'string' &&
    candidate.conversationId.length > 0
  )
}

@Injectable('NotificationService')
@DependsOn(['ConversationNavigationService'])
@ServicePhase(Phase.WhenReady)
export class NotificationService extends BaseService {
  private readonly activeNotifications = new Set<ElectronNotification>()
  /** Conversations with an unviewed reply or pending approval; drives the Windows taskbar badge. */
  private readonly unreadConversations = new Set<string>()
  private taskbarBadgeEnabled = false

  protected onStop(): void {
    this.activeNotifications.clear()
    this.unreadConversations.clear()
  }

  protected onInit(): void {
    this.registerDisposable(
      application
        .get('PreferenceService')
        .subscribeMultipleChanges([...OS_NOTIFICATION_PREF_KEYS], () => this.syncDockBadgeWithNotificationPrefs())
    )
    this.taskbarBadgeEnabled = application.get('PreferenceService').get(TASKBAR_BADGE_PREF_KEY)
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange(TASKBAR_BADGE_PREF_KEY, () => {
        this.taskbarBadgeEnabled = application.get('PreferenceService').get(TASKBAR_BADGE_PREF_KEY)
        this.syncTaskbarBadge()
      })
    )
    this.registerDisposable(
      application.get('WindowManager').onWindowCreatedByType(WindowType.Main, () => this.syncTaskbarBadge())
    )
    this.syncDockBadgeWithNotificationPrefs()
    const purge = () => {
      try {
        notificationRecordService.purgeExpired()
      } catch (error) {
        logger.warn('Failed to expire notification history', { error })
      }
    }
    purge()
    this.registerInterval(purge, 24 * 60 * 60 * 1000)
    // Windows drops taskbar overlay icons when Explorer recreates the taskbar (e.g. an
    // explorer.exe restart) without notifying apps; per Microsoft guidance overlays must
    // be reapplied. No Electron event carries that signal, so reapply on a slow interval.
    // syncTaskbarBadge() is a no-op off Windows and re-renders nothing when idle.
    this.registerInterval(
      () => {
        if (this.unreadConversations.size > 0) this.syncTaskbarBadge()
      },
      5 * 60 * 1000
    )
  }

  /** Called when the user is looking at a conversation; drops it from the taskbar badge count. */
  public markConversationViewed(target: ConversationNavigationTarget): void {
    if (this.unreadConversations.delete(conversationKey(target))) this.syncTaskbarBadge()
  }

  /** Drops removed conversations from the unread set so the badge stops counting them. */
  public dropUnreadConversations(
    conversationType: ConversationNavigationTarget['conversationType'],
    conversationIds: readonly string[]
  ): void {
    let changed = false
    for (const id of conversationIds) {
      if (this.unreadConversations.delete(conversationKey({ conversationType, conversationId: id }))) changed = true
    }
    if (changed) this.syncTaskbarBadge()
  }

  /** True when the conversation is already in front of the user in a focused window. */
  public async isConversationActiveInFocusedWindow(target: ConversationNavigationTarget): Promise<boolean> {
    return (
      getFullChromeWindowInfos().some((window) => window.isFocused) &&
      application.get('ConversationNavigationService').isActiveInFocusedWindow(target)
    )
  }

  /** Flags a conversation as needing attention; drives the Windows taskbar badge count. */
  public markConversationUnread(target: ConversationNavigationTarget): void {
    const key = conversationKey(target)
    if (this.unreadConversations.has(key)) return
    this.unreadConversations.add(key)
    this.syncTaskbarBadge()
  }

  /** Projects the unread-conversation count onto each main window's Windows taskbar button. */
  private syncTaskbarBadge(): void {
    if (!isWin) return

    const count = this.taskbarBadgeEnabled ? this.unreadConversations.size : 0
    let overlay: Electron.NativeImage | null = null
    if (count > 0) {
      const { buffer, width, height } = renderTaskbarBadgeBitmap(count)
      overlay = nativeImage.createFromBitmap(buffer, { width, height, scaleFactor: 2 })
    }
    const description = count > 0 ? t('notification.taskbar_badge.description', { count }) : ''

    for (const window of application.get('WindowManager').getWindowsByType(WindowType.Main)) {
      if (!window.isDestroyed()) window.setOverlayIcon(overlay, description)
    }
  }

  public async publish(
    input: CreateNotificationRecordInput,
    options: { source?: NotificationSource; completion?: boolean; recordOnly?: boolean } = {}
  ): Promise<boolean> {
    let committed = false
    try {
      const preferences = application.get('PreferenceService')
      const enabled = preferences.get(`app.notification.center.${input.category}.enabled`)
      const result = input.target?.result
      const completion = input.kind === 'task-completion' || input.kind === 'queue-completion'
      const active =
        enabled &&
        (completion || !!result) &&
        input.target?.kind === 'conversation' &&
        getFullChromeWindowInfos().some((window) => window.isFocused) &&
        (await application.get('ConversationNavigationService').isActiveInFocusedWindow(input.target))
      const suppressed = !enabled || (active && (completion || result?.status === 'succeeded'))
      const recordOnly = options.recordOnly || result?.status === 'cancelled' || (!!result && active)
      const initial = {
        ...input,
        readAt: result && recordOnly ? Date.now() : input.readAt
      }
      const record = result
        ? notificationRecordService.consumeTaskResult(input.eventKey, suppressed ? null : initial)
        : suppressed
          ? null
          : notificationRecordService.create(initial)
      if (!record) return true
      committed = true
      if (recordOnly) return true
      const windows = getFullChromeWindowInfos()
      const focused = windows.find((window) => window.isFocused)
      const owner = focused ?? windows.find((window) => window.type === WindowType.Main) ?? windows[0]
      let sound = false
      if (options.completion && preferences.get('app.notification.completion_sound.enabled') && owner) {
        try {
          application.get('IpcApiService').send(owner.id, 'notification.completion_sound', { id: record.id })
          sound = true
        } catch (error) {
          logger.warn('Failed to play completion sound', { error })
        }
      }
      if (focused) {
        if (options.completion || result || input.category === 'usage') {
          application.get('IpcApiService').send(focused.id, 'notification.present', record)
        }
        if (options.source !== 'update' && options.source !== 'backup') return true
      }
      const osKey =
        input.category === 'usage'
          ? 'app.notification.usage.os.enabled'
          : options.source && options.source !== 'mini-app'
            ? (`app.notification.${options.source}.enabled` as const)
            : undefined
      if (!osKey || !preferences.get(osKey)) return true
      const notification = new ElectronNotification({
        title: record.title,
        body: record.message,
        ...(sound ? { silent: true } : {})
      })
      notification.on('click', () => {
        void activateNotification(record.id).catch((error) =>
          logger.warn('Failed to open notification target', { error })
        )
      })
      this.showNotification(notification)
      return true
    } catch (error) {
      logger.warn('Failed to publish notification', { error, eventKey: input.eventKey })
      return committed
    }
  }

  /** Persists an authoritative outcome through the existing notification delivery policy. */
  public async publishTaskResult(input: TaskResultNotificationInput): Promise<boolean> {
    try {
      if (!input.resultId.trim() || !Number.isSafeInteger(input.finishedAt) || input.finishedAt < 0) return false
      const result = NotificationTaskResultSchema.parse(input)
      if (result.errorSummary) {
        result.errorSummary = Array.from(redactSecretTokens(redactSecretText(result.errorSummary)))
          .slice(0, 500)
          .join('')
      }
      return this.publish(
        {
          eventKey: `task-result:${JSON.stringify([result.source, input.resultId])}`,
          category: 'system',
          kind: 'task-result',
          title: {
            succeeded: t('notification.result.succeeded'),
            failed: t('notification.result.failed'),
            interrupted: t('notification.result.interrupted'),
            cancelled: t('notification.result.cancelled')
          }[result.status],
          message: result.errorSummary ? `${result.name}: ${result.errorSummary}` : result.name,
          createdAt: input.finishedAt,
          target: { ...input.target, result }
        },
        { source: 'assistant', completion: result.status === 'succeeded' }
      )
    } catch (error) {
      logger.warn('Invalid task result notification', { error })
      return false
    }
  }

  public async sendNotification(notification: Notification): Promise<void> {
    const electronNotification = new ElectronNotification({
      title: notification.title,
      body: notification.message,
      ...(notification.silent === undefined ? {} : { silent: notification.silent })
    })

    electronNotification.on('click', () => {
      if (notification.actionKey === CONVERSATION_NOTIFICATION_ACTION_KEY && isConversationTarget(notification.meta)) {
        void application
          .get('ConversationNavigationService')
          .focusOrOpen(notification.meta, resolveNotificationConversationName(notification.meta))
          .catch((error) => logger.error('Failed to open conversation from notification', error as Error))
        return
      }

      application.get('MainWindowService').showMainWindow()
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'notification.clicked', notification)
    })

    this.showNotification(electronNotification)
  }

  private showNotification(notification: ElectronNotification): void {
    this.activeNotifications.add(notification)
    const release = () => this.activeNotifications.delete(notification)
    notification.once('click', release)
    notification.once('close', release)
    notification.once('failed', release)
    try {
      notification.show()
    } catch (error) {
      release()
      throw error
    }
  }

  public deliverConversationNotification(notification: ConversationNotification): void {
    const focusedWindow = getFullChromeWindowInfos().find((window) => window.isFocused)
    if (focusedWindow) {
      application.get('IpcApiService').send(focusedWindow.id, 'notification.conversation', notification)
      return
    }

    if (!application.get('PreferenceService').get('app.notification.assistant.enabled')) return
    void this.sendNotification(notification)
  }

  private areAllOsNotificationPrefsDisabled(): boolean {
    const preferences = application.get('PreferenceService')
    return OS_NOTIFICATION_PREF_KEYS.every((key) => !preferences.get(key))
  }

  /** macOS Notification Center can leave a Dock count after prefs are all off (#20709). */
  private syncDockBadgeWithNotificationPrefs(): void {
    if (!this.areAllOsNotificationPrefsDisabled()) return
    app.setBadgeCount(0)
  }
}
