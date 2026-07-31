import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { useTabs } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { extractAgentSessionIdFromTopicId, isAgentSessionTopicId } from '@renderer/utils/agentSession'
import {
  buildSidebarAppOpenMetadata,
  getSidebarApp,
  getSidebarAppTabInstanceKey,
  tabBelongsToApp
} from '@renderer/utils/sidebar'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { TaskCompletionTarget } from '@shared/types/notification'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useTaskCompletionNotifications')

type CompletionTarget = TaskCompletionTarget & {
  appId: 'assistants' | 'agents'
}

function getCompletionTarget(topicId: string): CompletionTarget {
  if (isAgentSessionTopicId(topicId)) {
    return {
      appId: 'agents',
      conversationType: 'agent',
      conversationId: extractAgentSessionIdFromTopicId(topicId)
    }
  }

  return {
    appId: 'assistants',
    conversationType: 'assistant',
    conversationId: topicId
  }
}

function isTargetTab(target: CompletionTarget, tab: Tab): boolean {
  const app = getSidebarApp(target.appId)
  return (
    !!app &&
    tab.type === 'route' &&
    tabBelongsToApp(app, tab.url) &&
    getSidebarAppTabInstanceKey(app, tab) === target.conversationId
  )
}

function getTaskTargets(tabs: Tab[]): TaskCompletionTarget[] {
  const targets = new Map<string, TaskCompletionTarget>()

  for (const appId of ['assistants', 'agents'] as const) {
    const app = getSidebarApp(appId)
    if (!app) continue

    for (const tab of tabs) {
      if (tab.type !== 'route' || !tabBelongsToApp(app, tab.url)) continue
      const conversationId = getSidebarAppTabInstanceKey(app, tab)
      if (!conversationId) continue

      const target: TaskCompletionTarget = {
        conversationType: appId === 'agents' ? 'agent' : 'assistant',
        conversationId
      }
      targets.set(`${target.conversationType}:${conversationId}`, target)
    }
  }

  return [...targets.values()]
}

async function getCompletionName(target: CompletionTarget): Promise<string> {
  if (target.conversationType === 'agent') {
    const session = await dataApiService.get(`/agent-sessions/${target.conversationId}`)
    return session.name.trim()
  }

  const topic = await dataApiService.get(`/topics/${target.conversationId}`)
  return topic.name.trim()
}

export function useTaskCompletionNotifications(): void {
  const { t } = useTranslation()
  const { activeTab, openTab, setActiveTab, tabs } = useTabs()
  const tabsStateRef = useRef({ openTab, setActiveTab, tabs })
  tabsStateRef.current = { openTab, setActiveTab, tabs }
  const taskTargets = useMemo(() => getTaskTargets(tabs), [tabs])

  const activateLocalTarget = useCallback((target: CompletionTarget): boolean => {
    const current = tabsStateRef.current
    const existingTab = current.tabs.find((tab) => isTargetTab(target, tab))
    if (!existingTab) return false

    current.setActiveTab(existingTab.id)
    return true
  }, [])

  const openLocalTarget = useCallback((target: CompletionTarget, title: string): void => {
    const app = getSidebarApp(target.appId)
    if (!app?.instanceKey) return

    tabsStateRef.current.openTab(app.routePrefix, {
      forceNew: true,
      title,
      metadata: buildSidebarAppOpenMetadata(app, target.conversationId)
    })
  }, [])

  const focusOrOpenTarget = useCallback(
    async (target: CompletionTarget, title: string): Promise<void> => {
      if (activateLocalTarget(target)) return

      const focusedElsewhere = await ipcApi.request('notification.focus_task_target', {
        conversationType: target.conversationType,
        conversationId: target.conversationId
      })
      if (focusedElsewhere) return

      // Re-check after the main-process round trip: the tab set may have changed while
      // the toast was visible or while another window was being queried.
      if (!activateLocalTarget(target)) openLocalTarget(target, title)
    },
    [activateLocalTarget, openLocalTarget]
  )

  useEffect(() => {
    void ipcApi.request('notification.sync_task_targets', { targets: taskTargets }).catch((error) => {
      logger.warn('Failed to sync task notification targets', { err: error })
    })
  }, [taskTargets])

  useEffect(() => {
    return () => {
      void ipcApi.request('notification.sync_task_targets', { targets: [] }).catch((error) => {
        logger.warn('Failed to clear task notification targets', { err: error })
      })
    }
  }, [])

  useIpcOn('notification.task_completed', (completion) => {
    if (completion.delivery !== 'in-app') return

    const target = getCompletionTarget(completion.topicId)
    if (activeTab && isTargetTab(target, activeTab)) return

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
      const toastKey = `task-completion:${completion.turnId}`
      toast.success({
        key: toastKey,
        title,
        description: name,
        timeout: 6000,
        onClick: () => {
          toast.closeToast(toastKey)
          void focusOrOpenTarget(target, name).catch((error) => {
            logger.error('Failed to open completed conversation', error as Error)
          })
        }
      })
    })().catch((error) => {
      logger.error('Failed to surface task completion notification', error as Error)
    })
  })

  useIpcOn('notification.open_task_target_requested', ({ target }) => {
    const completionTarget: CompletionTarget = {
      ...target,
      appId: target.conversationType === 'agent' ? 'agents' : 'assistants'
    }
    if (activateLocalTarget(completionTarget)) return

    const fallbackName = target.conversationType === 'agent' ? t('agent.session.new') : t('chat.conversation.new')
    openLocalTarget(completionTarget, fallbackName)
  })
}
