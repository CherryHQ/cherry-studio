import { loggerService } from '@logger'
import { useTabs } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { findConversationTab } from '@renderer/utils/conversationNavigation'

const logger = loggerService.withContext('TaskCompletionNotificationRuntime')

/** Foreground-only presentation of main-prepared task-completion notifications. */
export function TaskCompletionNotificationRuntime(): null {
  const { activeTab } = useTabs()

  useIpcOn('notification.task_completed', (completion) => {
    if (activeTab && findConversationTab([activeTab], completion.target)) return

    const toastKey = `task-completion:${completion.turnId}`
    toast.success({
      key: toastKey,
      title: completion.title,
      description: completion.message,
      timeout: 6000,
      onClick: () => {
        toast.closeToast(toastKey)
        void ipcApi
          .request('navigation.focus_or_open_conversation', {
            target: completion.target,
            title: completion.message
          })
          .catch((error) => logger.error('Failed to open completed conversation', error as Error))
      }
    })
  })

  return null
}
