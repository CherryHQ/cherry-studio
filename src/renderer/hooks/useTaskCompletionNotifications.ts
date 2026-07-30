import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { useTabs } from '@renderer/hooks/tab'
import { useIpcOn } from '@renderer/ipc'
import { notificationService } from '@renderer/services/notification'
import { toast } from '@renderer/services/toast'
import { extractAgentSessionIdFromTopicId, isAgentSessionTopicId } from '@renderer/utils/agentSession'
import {
  buildSidebarAppOpenMetadata,
  getSidebarApp,
  getSidebarAppTabInstanceKey,
  tabBelongsToApp
} from '@renderer/utils/sidebar'
import {
  TASK_COMPLETION_NOTIFICATION_ACTION_KEY,
  type TaskCompletionNotificationMeta
} from '@shared/types/notification'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useTaskCompletionNotifications')

type CompletionTarget = {
  appId: 'assistants' | 'agents'
  conversationType: TaskCompletionNotificationMeta['conversationType']
  id: string
}

function getCompletionTarget(topicId: string): CompletionTarget {
  if (isAgentSessionTopicId(topicId)) {
    return {
      appId: 'agents',
      conversationType: 'agent',
      id: extractAgentSessionIdFromTopicId(topicId)
    }
  }

  return {
    appId: 'assistants',
    conversationType: 'assistant',
    id: topicId
  }
}

function isTaskCompletionNotificationMeta(meta: unknown): meta is TaskCompletionNotificationMeta {
  if (!meta || typeof meta !== 'object') return false

  const candidate = meta as Partial<TaskCompletionNotificationMeta>
  return (
    (candidate.conversationType === 'assistant' || candidate.conversationType === 'agent') &&
    typeof candidate.conversationId === 'string' &&
    candidate.conversationId.length > 0
  )
}

async function getCompletionName(target: CompletionTarget): Promise<string> {
  if (target.conversationType === 'agent') {
    const session = await dataApiService.get(`/agent-sessions/${target.id}`)
    return session.name.trim()
  }

  const topic = await dataApiService.get(`/topics/${target.id}`)
  return topic.name.trim()
}

export function useTaskCompletionNotifications(): void {
  const { t } = useTranslation()
  const { activeTab, openTab, setActiveTab, tabs } = useTabs()

  const isTargetTab = useCallback((target: CompletionTarget, tab: (typeof tabs)[number]): boolean => {
    const app = getSidebarApp(target.appId)
    return (
      !!app &&
      tab.type === 'route' &&
      tabBelongsToApp(app, tab.url) &&
      getSidebarAppTabInstanceKey(app, tab) === target.id
    )
  }, [])

  const focusOrOpenTarget = useCallback(
    (target: CompletionTarget, title: string) => {
      const existingTab = tabs.find((tab) => isTargetTab(target, tab))
      if (existingTab) {
        setActiveTab(existingTab.id)
        return
      }

      const app = getSidebarApp(target.appId)
      if (!app?.instanceKey) return

      openTab(app.routePrefix, {
        forceNew: true,
        title,
        metadata: buildSidebarAppOpenMetadata(app, target.id)
      })
    },
    [isTargetTab, openTab, setActiveTab, tabs]
  )

  useIpcOn('notification.task_completed', (completion) => {
    const target = getCompletionTarget(completion.topicId)

    if (completion.delivery === 'in-app' && activeTab && isTargetTab(target, activeTab)) {
      return
    }

    void (async () => {
      const fallbackName = target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')
      let name = fallbackName

      try {
        name = (await getCompletionName(target)) || fallbackName
      } catch (error) {
        logger.warn('Failed to resolve completed conversation name', {
          topicId: completion.topicId,
          err: error
        })
      }

      const title =
        target.conversationType === 'agent'
          ? t('notification.completion.agent')
          : t('notification.completion.assistant')

      if (completion.delivery === 'system') {
        await notificationService.send({
          id: `task-completion:${completion.turnId}`,
          type: 'success',
          title,
          message: name,
          timestamp: completion.completedAt,
          actionKey: TASK_COMPLETION_NOTIFICATION_ACTION_KEY,
          meta: {
            conversationType: target.conversationType,
            conversationId: target.id
          } satisfies TaskCompletionNotificationMeta,
          source: 'assistant'
        })
        return
      }

      const toastKey = `task-completion:${completion.turnId}`
      toast.success({
        key: toastKey,
        title,
        description: name,
        timeout: 6000,
        onClick: () => {
          toast.closeToast(toastKey)
          focusOrOpenTarget(target, name)
        }
      })
    })().catch((error) => {
      logger.error('Failed to surface task completion notification', error as Error)
    })
  })

  useIpcOn('notification.clicked', (notification) => {
    if (
      notification.actionKey !== TASK_COMPLETION_NOTIFICATION_ACTION_KEY ||
      !isTaskCompletionNotificationMeta(notification.meta)
    ) {
      return
    }

    const target: CompletionTarget = {
      appId: notification.meta.conversationType === 'agent' ? 'agents' : 'assistants',
      conversationType: notification.meta.conversationType,
      id: notification.meta.conversationId
    }
    focusOrOpenTarget(target, notification.message)
  })
}
