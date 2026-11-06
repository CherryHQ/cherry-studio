import { app, nativeImage, Notification as ElectronNotification } from 'electron'

import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import type { ConversationCompletedEvent } from '@main/ai/streamManager'
import type { ApprovalRequestedEvent } from '@main/ai/types'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import { renderTaskbarBadgeBitmap } from '@main/utils/taskbarBadgeIcon'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import {
  CONVERSATION_NOTIFICATION_ACTION_KEY,
  type ConversationNotification,
  type Notification
} from '@shared/types/notification'

const logger = loggerService.withContext('NotificationService')
const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })

/** OS notification category gates — all off means the Dock badge must clear (#20709). */
const OS_NOTIFICATION_PREF_KEYS = [
  'app.notification.assistant.enabled',
  'app.notification.backup.enabled',
  'app.notification.knowledge.enabled',
  'app.notification.update.enabled',
  'app.notification.mini_app.enabled'
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
@DependsOn(['AgentSessionRuntimeService', 'AiStreamManager', 'ConversationNavigationService'])
@ServicePhase(Phase.WhenReady)
export class NotificationService extends BaseService {
  /** Conversations with an unviewed reply or pending approval; drives the Windows taskbar badge. */
  private readonly unreadConversations = new Set<string>()

  protected onInit(): void {
    this.registerDisposable(
      application.get('AiStreamManager').onConversationCompleted((event) => this.handleConversationCompleted(event))
    )
    this.registerDisposable(
      application.get('AiStreamManager').onApprovalRequested((event) => this.handleApprovalRequested(event))
    )
    this.registerDisposable(
      application.get('AgentSessionRuntimeService').onApprovalRequested((event) => this.handleApprovalRequested(event))
    )
    this.registerDisposable(
      application
        .get('PreferenceService')
        .subscribeMultipleChanges([...OS_NOTIFICATION_PREF_KEYS], () => this.syncDockBadgeWithNotificationPrefs())
    )
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange(TASKBAR_BADGE_PREF_KEY, () => this.syncTaskbarBadge())
    )
    this.registerDisposable(
      application.get('WindowManager').onWindowCreatedByType(WindowType.Main, () => this.syncTaskbarBadge())
    )
    this.syncDockBadgeWithNotificationPrefs()
  }

  protected onStop(): void {
    this.unreadConversations.clear()
  }

  /** Called when the user is looking at a conversation; drops it from the taskbar badge count. */
  public markConversationViewed(target: ConversationNavigationTarget): void {
    if (this.unreadConversations.delete(conversationKey(target))) this.syncTaskbarBadge()
  }

  public async sendNotification(notification: Notification): Promise<void> {
    const electronNotification = new ElectronNotification({
      title: notification.title,
      body: notification.message
    })

    electronNotification.on('click', () => {
      if (notification.actionKey === CONVERSATION_NOTIFICATION_ACTION_KEY && isConversationTarget(notification.meta)) {
        void application
          .get('ConversationNavigationService')
          .focusOrOpen(notification.meta, this.resolveConversationName(notification.meta))
          .catch((error) => logger.error('Failed to open conversation from notification', error as Error))
        return
      }

      application.get('MainWindowService').showMainWindow()
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'notification.clicked', notification)
    })

    electronNotification.show()
  }

  private handleConversationCompleted({
    topicId,
    turnId,
    completedAt,
    responseText
  }: ConversationCompletedEvent): void {
    const target = this.resolveConversationTarget(topicId)
    this.markConversationUnread(target)
    const fallbackTitle =
      target.conversationType === 'agent' ? t('notification.completion.agent') : t('notification.completion.assistant')
    const conversationName = this.resolveConversationName(target, fallbackTitle)
    const lastSentence = [...sentenceSegmenter.segment(responseText?.trim() ?? '')].at(-1)?.segment.trim()
    this.deliverConversationNotification({
      id: `task-completion:${turnId}`,
      kind: 'task-completion',
      type: 'success',
      title: conversationName,
      conversationName,
      message: lastSentence || conversationName,
      timestamp: completedAt,
      actionKey: CONVERSATION_NOTIFICATION_ACTION_KEY,
      meta: target,
      source: 'assistant'
    })
  }

  private handleApprovalRequested({ topicId, approvalId, requestedAt }: ApprovalRequestedEvent): void {
    const target = this.resolveConversationTarget(topicId)
    this.markConversationUnread(target)
    const title =
      target.conversationType === 'agent'
        ? t('notification.action_required.agent')
        : t('notification.action_required.assistant')
    const conversationName = this.resolveConversationName(target)
    this.deliverConversationNotification({
      id: `approval-request:${approvalId}`,
      kind: 'approval-request',
      type: 'warning',
      title,
      conversationName,
      message: conversationName,
      timestamp: requestedAt,
      actionKey: CONVERSATION_NOTIFICATION_ACTION_KEY,
      meta: target,
      source: 'assistant'
    })
  }

  private deliverConversationNotification(notification: ConversationNotification): void {
    const focusedWindow = getFullChromeWindowInfos().find((window) => window.isFocused)
    if (focusedWindow) {
      application.get('IpcApiService').send(focusedWindow.id, 'notification.conversation', notification)
      return
    }

    if (!application.get('PreferenceService').get('app.notification.assistant.enabled')) return
    void this.sendNotification(notification)
  }

  private markConversationUnread(target: ConversationNavigationTarget): void {
    const key = conversationKey(target)
    if (this.unreadConversations.has(key)) return
    this.unreadConversations.add(key)
    this.syncTaskbarBadge()
  }

  /** Projects the unread-conversation count onto each main window's Windows taskbar button. */
  private syncTaskbarBadge(): void {
    if (!isWin) return

    const count = application.get('PreferenceService').get(TASKBAR_BADGE_PREF_KEY) ? this.unreadConversations.size : 0
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

  private areAllOsNotificationPrefsDisabled(): boolean {
    const preferences = application.get('PreferenceService')
    return OS_NOTIFICATION_PREF_KEYS.every((key) => !preferences.get(key))
  }

  /** macOS Notification Center can leave a Dock count after prefs are all off (#20709). */
  private syncDockBadgeWithNotificationPrefs(): void {
    if (!this.areAllOsNotificationPrefsDisabled()) return
    app.setBadgeCount(0)
  }

  private resolveConversationTarget(topicId: string): ConversationNavigationTarget {
    return isAgentSessionTopic(topicId)
      ? { conversationType: 'agent', conversationId: extractAgentSessionId(topicId) }
      : { conversationType: 'assistant', conversationId: topicId }
  }

  private resolveConversationName(
    target: ConversationNavigationTarget,
    fallback = target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')
  ): string {
    try {
      const name =
        target.conversationType === 'agent'
          ? agentSessionService.getById(target.conversationId).name
          : topicService.getById(target.conversationId).name
      return name.trim() || fallback
    } catch (error) {
      logger.warn('Failed to resolve conversation name for notification', { target, err: error })
      return fallback
    }
  }
}
