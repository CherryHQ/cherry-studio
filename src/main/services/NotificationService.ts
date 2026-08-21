import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import type { ConversationCompletedEvent } from '@main/ai/streamManager'
import type { ApprovalRequestedEvent } from '@main/ai/types'
import { BaseService, DependsOn, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import type { TopicStatusSnapshotEntry } from '@shared/ai/transport'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import {
  CONVERSATION_NOTIFICATION_ACTION_KEY,
  type ConversationNotification,
  type Notification
} from '@shared/types/notification'
import { Notification as ElectronNotification } from 'electron'

const logger = loggerService.withContext('NotificationService')
const TOPIC_STATUS_PREFIX = 'topic.stream.statuses.'

export interface ConversationActivityChangedEvent {
  topicId: string
  target: ConversationNavigationTarget
  snapshot: TopicStatusSnapshotEntry | null
  changedAt: number
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
  private readonly _onConversationActivityChanged = this.registerDisposable(
    new Emitter<ConversationActivityChangedEvent>()
  )
  public readonly onConversationActivityChanged: Event<ConversationActivityChangedEvent> =
    this._onConversationActivityChanged.event

  protected onInit(): void {
    const cacheService = application.get('CacheService')
    this.registerDisposable(
      cacheService.subscribeSharedChange('topic.stream.statuses.${topicId}', (snapshot, _oldSnapshot, key) =>
        this.emitConversationActivity(snapshot, key)
      )
    )
    this.registerDisposable(
      cacheService.subscribeSharedChange(
        'topic.stream.statuses.agent-session:${sessionId}',
        (snapshot, _oldSnapshot, key) => this.emitConversationActivity(snapshot, key)
      )
    )
    this.registerDisposable(
      application.get('AiStreamManager').onConversationCompleted((event) => this.handleConversationCompleted(event))
    )
    this.registerDisposable(
      application.get('AiStreamManager').onApprovalRequested((event) => this.handleApprovalRequested(event))
    )
    this.registerDisposable(
      application.get('AgentSessionRuntimeService').onApprovalRequested((event) => this.handleApprovalRequested(event))
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

  private handleConversationCompleted({ topicId, turnId, completedAt }: ConversationCompletedEvent): void {
    const target = this.resolveConversationTarget(topicId)
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

  private handleApprovalRequested({ topicId, approvalId, requestedAt }: ApprovalRequestedEvent): void {
    const target = this.resolveConversationTarget(topicId)
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

  private emitConversationActivity(snapshot: TopicStatusSnapshotEntry | null | undefined, concreteKey: string): void {
    const topicId = concreteKey.slice(TOPIC_STATUS_PREFIX.length)
    if (!topicId) return

    this._onConversationActivityChanged.fire({
      topicId,
      target: this.resolveConversationTarget(topicId),
      snapshot: snapshot ?? null,
      changedAt: Date.now()
    })
  }

  private resolveConversationTarget(topicId: string): ConversationNavigationTarget {
    return isAgentSessionTopic(topicId)
      ? { conversationType: 'agent', conversationId: extractAgentSessionId(topicId) }
      : { conversationType: 'assistant', conversationId: topicId }
  }

  public resolveConversationName(target: ConversationNavigationTarget): string {
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
