import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import type { ConversationCompletedEvent } from '@main/ai/streamManager'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import {
  type Notification,
  TASK_COMPLETION_NOTIFICATION_ACTION_KEY,
  type TaskCompletionNotificationMeta
} from '@shared/types/notification'
import { Notification as ElectronNotification } from 'electron'

const logger = loggerService.withContext('NotificationService')

function isTaskCompletionMeta(meta: unknown): meta is TaskCompletionNotificationMeta {
  if (!meta || typeof meta !== 'object') return false

  const candidate = meta as Partial<TaskCompletionNotificationMeta>
  return (
    (candidate.conversationType === 'assistant' || candidate.conversationType === 'agent') &&
    typeof candidate.conversationId === 'string' &&
    candidate.conversationId.length > 0
  )
}

@Injectable('NotificationService')
@DependsOn(['AiStreamManager', 'ConversationNavigationService'])
@ServicePhase(Phase.WhenReady)
export class NotificationService extends BaseService {
  protected onInit(): void {
    this.registerDisposable(
      application.get('AiStreamManager').onConversationCompleted((event) => this.handleConversationCompleted(event))
    )
  }

  public async sendNotification(notification: Notification): Promise<void> {
    const electronNotification = new ElectronNotification({
      title: notification.title,
      body: notification.message
    })

    electronNotification.on('click', () => {
      if (
        notification.actionKey === TASK_COMPLETION_NOTIFICATION_ACTION_KEY &&
        isTaskCompletionMeta(notification.meta)
      ) {
        void application
          .get('ConversationNavigationService')
          .focusOrOpen(notification.meta, notification.message)
          .catch((error) => logger.error('Failed to open completed conversation', error as Error))
        return
      }

      application.get('MainWindowService').showMainWindow()
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'notification.clicked', notification)
    })

    electronNotification.show()
  }

  private handleConversationCompleted({ turnId, completedAt, conversation }: ConversationCompletedEvent): void {
    const windowManager = application.get('WindowManager')
    const mainWindows = windowManager.getWindowInfosByType(WindowType.Main)
    const subWindows = windowManager
      .getWindowInfosByType(WindowType.SubWindow)
      .filter((window) => window.isVisible || window.isFocused)
    const fullChromeWindows = [...mainWindows, ...subWindows]
    const focusedWindow = fullChromeWindows.find((window) => window.isFocused)

    if (!focusedWindow) {
      if (fullChromeWindows.length === 0) return
      if (!application.get('PreferenceService').get('app.notification.assistant.enabled')) return
    }

    const target: ConversationNavigationTarget = {
      conversationType: conversation.type,
      conversationId: conversation.id
    }
    const title =
      target.conversationType === 'agent' ? t('notification.completion.agent') : t('notification.completion.assistant')
    const message = this.resolveTaskTargetName(target)

    if (focusedWindow) {
      application.get('IpcApiService').send(focusedWindow.id, 'notification.task_completed', {
        turnId,
        target,
        title,
        message
      })
      return
    }

    void this.sendNotification({
      id: `task-completion:${turnId}`,
      type: 'success',
      title,
      message,
      timestamp: completedAt,
      actionKey: TASK_COMPLETION_NOTIFICATION_ACTION_KEY,
      meta: target,
      source: 'assistant'
    })
  }

  private resolveTaskTargetName(target: ConversationNavigationTarget): string {
    const fallback = target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')

    try {
      const name =
        target.conversationType === 'agent'
          ? agentSessionService.getById(target.conversationId).name
          : topicService.getById(target.conversationId).name
      return name.trim() || fallback
    } catch (error) {
      logger.warn('Failed to resolve completed conversation name', { target, err: error })
      return fallback
    }
  }
}
