import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { useTabs } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { playCompletionSound } from '@renderer/services/notification'
import { toast } from '@renderer/services/toast'
import { findConversationTab } from '@renderer/utils/conversationNavigation'
import { getSidebarApp, resolveSidebarActiveItem } from '@renderer/utils/sidebar'

import { notificationCategoryIcons, notificationPreview } from './notificationPresentation'
import { NotificationTitle } from './NotificationTitle'

const logger = loggerService.withContext('ConversationNotificationRuntime')

/** Foreground-only presentation of main-prepared conversation notifications. */
export function ConversationNotificationRuntime(): null {
  const { activeTab } = useTabs()
  const { t } = useTranslation()

  useEffect(() => {
    if (activeTab?.type !== 'route') return
    const appId = resolveSidebarActiveItem(activeTab.url)
    if (appId !== 'agents' && appId !== 'assistants') return
    const conversationId = getSidebarApp(appId)?.conversationRoute?.keyFromUrl(activeTab.url)
    if (!conversationId) return
    const markRead = () => {
      if (!document.hasFocus() || document.visibilityState !== 'visible') return
      void dataApiService
        .post('/notifications/read-conversation', {
          body: { conversationType: appId === 'agents' ? 'agent' : 'assistant', conversationId }
        })
        .catch((error) => logger.error('Failed to mark conversation notifications read', error as Error))
    }
    markRead()
    window.addEventListener('focus', markRead)
    document.addEventListener('visibilitychange', markRead)
    return () => {
      window.removeEventListener('focus', markRead)
      document.removeEventListener('visibilitychange', markRead)
    }
  }, [activeTab?.type, activeTab?.url])

  useIpcOn('notification.completion_sound', () => {
    playCompletionSound()
  })

  useIpcOn('notification.present', (notification) => {
    if (
      notification.category === 'system' &&
      notification.target?.kind === 'conversation' &&
      activeTab &&
      findConversationTab([activeTab], notification.target)
    )
      return

    const showToast =
      notification.category === 'usage' ||
      notification.kind === 'backup-failed' ||
      notification.kind === 'backup-warning'
        ? toast.warning
        : notification.category === 'official'
          ? toast.info
          : toast.success
    const Icon = notificationCategoryIcons[notification.category]
    showToast({
      key: notification.id,
      title: <NotificationTitle record={notification} />,
      description: notificationPreview(notification.message),
      icon: <Icon aria-hidden="true" className="size-4" />,
      timeout: 6000,
      onClick: () => {
        toast.closeToast(notification.id)
        void ipcApi.request('notification.activate', { id: notification.id }).catch((error) => {
          logger.error('Failed to activate notification', error as Error)
          toast.error(t('notification.center.activation_failed'))
        })
      }
    })
  })

  useIpcOn('notification.conversation', (notification) => {
    if (activeTab && findConversationTab([activeTab], notification.meta)) return

    toast.warning({
      key: notification.id,
      title: notificationPreview(notification.title, true),
      description: notificationPreview(notification.message),
      timeout: 6000,
      onClick: () => {
        toast.closeToast(notification.id)
        void ipcApi
          .request('navigation.focus_or_open_conversation', {
            target: notification.meta,
            title: notification.conversationName
          })
          .catch((error) => logger.error('Failed to open conversation from notification', error as Error))
      }
    })
  })

  return null
}
