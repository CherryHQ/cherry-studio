import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useTabs } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { playCompletionSound } from '@renderer/services/notification'
import { toast } from '@renderer/services/toast'
import { findConversationTab } from '@renderer/utils/conversationNavigation'

import { notificationCategoryIcons, notificationPreview } from './notificationPresentation'

const logger = loggerService.withContext('ConversationNotificationRuntime')

/** Foreground-only presentation of main-prepared conversation notifications. */
export function ConversationNotificationRuntime(): null {
  const { activeTab } = useTabs()
  const { t } = useTranslation()

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
      title: notificationPreview(notification.title, true),
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

    const showToast = notification.kind === 'task-completion' ? toast.success : toast.warning
    showToast({
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
