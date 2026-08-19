import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import type { ConversationCompletedEvent } from '@main/ai/streamManager'
import type { ApprovalRequestedEvent } from '@main/ai/types'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import { ConversationKind, type ConversationRef } from '@shared/ai/conversation'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import {
  CONVERSATION_NOTIFICATION_ACTION_KEY,
  type ConversationNotification,
  type Notification
} from '@shared/types/notification'
import { Notification as ElectronNotification } from 'electron'

const logger = loggerService.withContext('NotificationService')

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
@DependsOn(['AgentConnectionManager', 'ConversationRuntimeService', 'ConversationNavigationService'])
@ServicePhase(Phase.WhenReady)
export class NotificationService extends BaseService {
  protected onInit(): void {
    this.registerDisposable(
      application
        .get('ConversationRuntimeService')
        .onConversationCompleted((event) => this.handleConversationCompleted(event))
    )
    this.registerDisposable(
      application.get('ConversationRuntimeService').onApprovalRequested((event) => this.handleApprovalRequested(event))
    )
    this.registerDisposable(
      application.get('AgentConnectionManager').onApprovalRequested((event) => this.handleApprovalRequested(event))
    )
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
          .focusOrOpen(notification.meta, notification.message)
          .catch((error) => logger.error('Failed to open conversation from notification', error as Error))
        return
      }

      application.get('MainWindowService').showMainWindow()
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'notification.clicked', notification)
    })

    electronNotification.show()
  }

  private handleConversationCompleted({ conversation, turnId, completedAt }: ConversationCompletedEvent): void {
    const target = this.resolveConversationTarget(conversation)
    const title =
      target.conversationType === 'agent' ? t('notification.completion.agent') : t('notification.completion.assistant')
    this.deliverConversationNotification({
      id: `task-completion:${turnId}`,
      kind: 'task-completion',
      type: 'success',
      title,
      message: this.resolveConversationName(target),
      timestamp: completedAt,
      actionKey: CONVERSATION_NOTIFICATION_ACTION_KEY,
      meta: target,
      source: 'assistant'
    })
  }

  private handleApprovalRequested({ conversation, approvalId, requestedAt }: ApprovalRequestedEvent): void {
    const target = this.resolveConversationTarget(conversation)
    const title =
      target.conversationType === 'agent'
        ? t('notification.action_required.agent')
        : t('notification.action_required.assistant')
    this.deliverConversationNotification({
      id: `approval-request:${approvalId}`,
      kind: 'approval-request',
      type: 'warning',
      title,
      message: this.resolveConversationName(target),
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

  private resolveConversationTarget(conversation: ConversationRef): ConversationNavigationTarget {
    return conversation.kind === ConversationKind.Agent
      ? { conversationType: 'agent', conversationId: conversation.id }
      : { conversationType: 'assistant', conversationId: conversation.id }
  }

  private resolveConversationName(target: ConversationNavigationTarget): string {
    const fallback = target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')

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
