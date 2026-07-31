import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
import {
  type Notification,
  TASK_COMPLETION_NOTIFICATION_ACTION_KEY,
  type TaskCompletionNotificationMeta,
  type TaskCompletionTarget
} from '@shared/types/notification'
import { Notification as ElectronNotification } from 'electron'

import { openRouteInMainWindow } from './mainWindowNavigation'

const logger = loggerService.withContext('NotificationService')

interface TaskCompletionSignal {
  topicId: string
  turnId: string
  completedAt: number
  target: TaskCompletionTarget
}

function isTaskCompletionMeta(meta: unknown): meta is TaskCompletionNotificationMeta {
  if (!meta || typeof meta !== 'object') return false

  const candidate = meta as Partial<TaskCompletionNotificationMeta>
  return (
    (candidate.conversationType === 'assistant' || candidate.conversationType === 'agent') &&
    typeof candidate.conversationId === 'string' &&
    candidate.conversationId.length > 0
  )
}

function isSameTaskTarget(left: TaskCompletionTarget, right: TaskCompletionTarget): boolean {
  return left.conversationType === right.conversationType && left.conversationId === right.conversationId
}

@Injectable('NotificationService')
@ServicePhase(Phase.WhenReady)
export class NotificationService extends BaseService {
  private readonly taskTargetsByWindow = new Map<string, TaskCompletionTarget[]>()

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
        this.openTaskTarget(notification.meta)
        return
      }

      application.get('MainWindowService').showMainWindow()
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'notification.clicked', notification)
    })

    electronNotification.show()
  }

  public notifyTaskCompletion({ topicId, turnId, completedAt, target }: TaskCompletionSignal): void {
    const windowManager = application.get('WindowManager')
    const mainWindows = windowManager.getWindowInfosByType(WindowType.Main)
    const subWindows = windowManager
      .getWindowInfosByType(WindowType.SubWindow)
      .filter((window) => window.isVisible || window.isFocused)
    const fullChromeWindows = [...mainWindows, ...subWindows]
    const focusedWindow = fullChromeWindows.find((window) => window.isFocused)

    if (focusedWindow) {
      application.get('IpcApiService').send(focusedWindow.id, 'notification.task_completed', {
        topicId,
        turnId,
        completedAt,
        delivery: 'in-app'
      })
      return
    }

    if (fullChromeWindows.length === 0) return
    if (!application.get('PreferenceService').get('app.notification.assistant.enabled')) return

    const title =
      target.conversationType === 'agent' ? t('notification.completion.agent') : t('notification.completion.assistant')
    const message = this.resolveTaskTargetName(target)

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

  public syncTaskTargets(windowId: string, targets: TaskCompletionTarget[]): void {
    if (targets.length === 0) {
      this.taskTargetsByWindow.delete(windowId)
      return
    }
    this.taskTargetsByWindow.set(windowId, targets)
  }

  public focusTaskTarget(target: TaskCompletionTarget, requestingWindowId: string | null): boolean {
    return this.focusRegisteredTaskTarget(target, requestingWindowId)
  }

  protected onDestroy(): void {
    this.taskTargetsByWindow.clear()
  }

  private resolveTaskTargetName(target: TaskCompletionTarget): string {
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

  private openTaskTarget(target: TaskCompletionTarget): void {
    if (this.focusRegisteredTaskTarget(target, null)) return

    const route =
      target.conversationType === 'agent'
        ? `/app/agents?sessionId=${encodeURIComponent(target.conversationId)}`
        : `/app/chat?topicId=${encodeURIComponent(target.conversationId)}`
    openRouteInMainWindow(route)
  }

  private focusRegisteredTaskTarget(target: TaskCompletionTarget, excludedWindowId: string | null): boolean {
    const windowManager = application.get('WindowManager')

    for (const [windowId, targets] of this.taskTargetsByWindow) {
      if (windowId === excludedWindowId || !targets.some((candidate) => isSameTaskTarget(candidate, target))) continue

      const window = windowManager.getWindow(windowId)
      if (!window || window.isDestroyed()) {
        this.taskTargetsByWindow.delete(windowId)
        continue
      }

      application.get('IpcApiService').send(windowId, 'notification.open_task_target_requested', { target })

      if (windowManager.getWindowType(windowId) === WindowType.Main) {
        application.get('MainWindowService').showMainWindow()
      } else {
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
      }
      return true
    }

    return false
  }
}
