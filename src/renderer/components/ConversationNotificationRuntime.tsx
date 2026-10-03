import { loggerService } from '@logger'
import { useTabs } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { findConversationTab } from '@renderer/utils/conversationNavigation'

const logger = loggerService.withContext('ConversationNotificationRuntime')

/** Foreground-only presentation of main-prepared conversation notifications. */
export function ConversationNotificationRuntime(): null {
  const { activeTab } = useTabs()

  useIpcOn('notification.conversation', (notification) => {
    if (activeTab && findConversationTab([activeTab], notification.meta)) return

    const showToast = notification.kind === 'task-completion' ? toast.success : toast.warning
    showToast({
      key: notification.id,
      title: notification.title,
      description: notification.message,
      timeout: 6000,
      onClick: () => {
        toast.closeToast(notification.id)
        void ipcApi
          .request('navigation.focus_or_open_conversation', {
            target: notification.meta,
            title: notification.message
          })
          .catch((error) => logger.error('Failed to open conversation from notification', error as Error))
      }
    })
  })

  return null
}
