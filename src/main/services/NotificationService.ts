import { app, Notification as ElectronNotification } from 'electron'

import { application } from '@application'
import { type CreateNotificationRecordInput, notificationRecordService } from '@data/services/NotificationRecordService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import type { AgentApprovalStatus } from '@shared/ai/agentSessionApprovals'
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
  private readonly approvalNotifications = new Map<string, ElectronNotification>()
  private readonly activeNotifications = new Set<ElectronNotification>()

  protected onStop(): void {
    this.activeNotifications.clear()
    this.approvalNotifications.clear()
  }

  protected onInit(): void {
    this.registerDisposable(
      application
        .get('PreferenceService')
        .subscribeMultipleChanges([...OS_NOTIFICATION_PREF_KEYS], () => this.syncDockBadgeWithNotificationPrefs())
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
      if (record.target?.kind === 'conversation' && record.target.approval) {
        const current = notificationRecordService.getById(record.id)
        if (current?.target?.kind !== 'conversation' || current.target.approval?.status !== 'pending') return true
      }
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
        if (options.completion || result || input.category === 'usage' || input.kind === 'approval-request') {
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
      if (record.kind === 'approval-request') {
        this.approvalNotifications.set(record.id, notification)
        const release = () => this.approvalNotifications.delete(record.id)
        notification.once('click', release)
        notification.once('close', release)
        notification.once('failed', release)
      }
      this.showNotification(notification)
      return true
    } catch (error) {
      logger.warn('Failed to publish notification', { error, eventKey: input.eventKey })
      return committed
    }
  }

  public settleApproval(registrationId: string, status: Exclude<AgentApprovalStatus, 'pending'>): void {
    try {
      for (const id of notificationRecordService.settleApproval(registrationId, status)) {
        try {
          this.approvalNotifications.get(id)?.close()
          this.approvalNotifications.delete(id)
          application.get('IpcApiService').broadcast('notification.retired', { id })
        } catch (error) {
          logger.warn('Failed to close approval reminder', { id, error })
        }
      }
    } catch (error) {
      logger.warn('Failed to settle approval notification', { registrationId, error })
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
