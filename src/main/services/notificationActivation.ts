import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { notificationRecordService } from '@data/services/NotificationRecordService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import type { ConversationNavigationTarget } from '@shared/types/navigation'

import { openNotificationInMainWindow, openRouteInMainWindow } from './mainWindowNavigation'

const logger = loggerService.withContext('notificationActivation')

export async function activateNotification(id: string): Promise<void> {
  const record = notificationRecordService.getById(id)
  if (!record) throw new Error(t('notification.center.target_unavailable'))
  notificationRecordService.markRead(id)
  const target = record.target
  if (!target) return
  if (target.kind === 'conversation') {
    try {
      const entity =
        target.conversationType === 'agent'
          ? agentSessionService.getById(target.conversationId)
          : topicService.getById(target.conversationId)
      if (entity.deletedAt) throw new Error('Deleted conversation')
    } catch {
      throw new Error(t('notification.center.target_unavailable'))
    }
    const conversation = { conversationType: target.conversationType, conversationId: target.conversationId }
    await application
      .get('ConversationNavigationService')
      .focusOrOpen(conversation, resolveNotificationConversationName(target), null, undefined, target.messageId)
  } else if (target.kind === 'scheduled-task') {
    try {
      if (!agentTaskService.getTaskById(target.taskId)) throw new Error('Deleted task')
    } catch {
      throw new Error(t('notification.center.target_unavailable'))
    }
    openRouteInMainWindow(
      `/settings/scheduled-tasks/${encodeURIComponent(target.taskId)}?notificationId=${encodeURIComponent(id)}`
    )
  } else if (target.kind === 'settings') {
    openRouteInMainWindow(`/settings/${target.tab}`)
  } else if (target.kind === 'knowledge') {
    try {
      knowledgeBaseService.getById(target.baseId)
    } catch {
      throw new Error(t('notification.center.target_unavailable'))
    }
    openRouteInMainWindow(`/app/knowledge?baseId=${encodeURIComponent(target.baseId)}`)
  } else {
    openNotificationInMainWindow(id)
  }
}

export function resolveNotificationConversationName(
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
