import { application } from '@application'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import type { ConversationCompletedEvent, ConversationUnsuccessfulEvent } from '@main/ai/streamManager'
import type { ApprovalRequestedEvent } from '@main/ai/types'
import { stripCitationMarkers } from '@main/ai/utils/citationIds'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import { CONVERSATION_NOTIFICATION_ACTION_KEY } from '@shared/types/notification'

import { resolveNotificationConversationName } from './notificationActivation'

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })

@Injectable('ConversationNotificationService')
@DependsOn(['AgentSessionRuntimeService', 'AiStreamManager', 'NotificationService'])
@ServicePhase(Phase.WhenReady)
export class ConversationNotificationService extends BaseService {
  protected onInit(): void {
    this.registerDisposable(
      application.get('AiStreamManager').onConversationCompleted((event) => this.handleConversationCompleted(event))
    )
    this.registerDisposable(
      application
        .get('AiStreamManager')
        .onConversationUnsuccessful((event) => this.handleConversationUnsuccessful(event))
    )
    this.registerDisposable(
      application.get('AiStreamManager').onApprovalRequested((event) => this.handleApprovalRequested(event))
    )
    this.registerDisposable(
      application.get('AgentSessionRuntimeService').onApprovalRequested((event) => this.handleApprovalRequested(event))
    )
  }

  private handleConversationUnsuccessful(event: ConversationUnsuccessfulEvent): void {
    const target = this.resolveConversationTarget(event.topicId)
    void application.get('NotificationService').publishTaskResult({
      ...event,
      source: target.conversationType,
      name: resolveNotificationConversationName(
        target,
        target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')
      ),
      target: { kind: 'conversation', ...target, messageId: event.messageId }
    })
  }

  private handleConversationCompleted({
    topicId,
    turnId,
    completedAt,
    responseText,
    completedTaskCount
  }: ConversationCompletedEvent): void {
    const target = this.resolveConversationTarget(topicId)
    const fallbackTitle =
      target.conversationType === 'agent' ? t('notification.completion.agent') : t('notification.completion.assistant')
    const conversationName = resolveNotificationConversationName(target, fallbackTitle)
    const lastSentence = [...sentenceSegmenter.segment(stripCitationMarkers(responseText ?? '').trim())]
      .at(-1)
      ?.segment.trim()
    void application.get('NotificationService').publish(
      {
        eventKey: `task-completion:${topicId}:${turnId}`,
        category: 'system',
        kind: completedTaskCount && completedTaskCount > 1 ? 'queue-completion' : 'task-completion',
        title:
          completedTaskCount && completedTaskCount > 1
            ? t('notification.center.queue_complete', { count: completedTaskCount })
            : fallbackTitle,
        message: lastSentence
          ? conversationName === fallbackTitle
            ? lastSentence
            : `${conversationName}\n${lastSentence}`
          : conversationName,
        createdAt: completedAt,
        target: { kind: 'conversation', ...target, replyPreview: lastSentence ?? '' }
      },
      { source: 'assistant', completion: true }
    )
  }

  private handleApprovalRequested({ topicId, approvalId, requestedAt }: ApprovalRequestedEvent): void {
    const target = this.resolveConversationTarget(topicId)
    const title =
      target.conversationType === 'agent'
        ? t('notification.action_required.agent')
        : t('notification.action_required.assistant')
    const conversationName = resolveNotificationConversationName(target)
    application.get('NotificationService').deliverConversationNotification({
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

  private resolveConversationTarget(topicId: string): ConversationNavigationTarget {
    return isAgentSessionTopic(topicId)
      ? { conversationType: 'agent', conversationId: extractAgentSessionId(topicId) }
      : { conversationType: 'assistant', conversationId: topicId }
  }
}
