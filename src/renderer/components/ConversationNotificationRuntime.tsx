import { useCallback, useEffect } from 'react'

import { loggerService } from '@logger'
import { useTabs } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { findConversationTab, getConversationTargetFromTab } from '@renderer/utils/conversationNavigation'

const logger = loggerService.withContext('ConversationNotificationRuntime')

/** Foreground-only presentation of main-prepared conversation notifications. */
export function ConversationNotificationRuntime(): null {
  const { activeTab } = useTabs()
  const activeTarget = getConversationTargetFromTab(activeTab)
  const activeType = activeTarget?.conversationType
  const activeId = activeTarget?.conversationId

  // Reading it from a focused window is what clears the conversation from the taskbar badge.
  const reportViewed = useCallback(() => {
    if (!activeType || !activeId || !document.hasFocus()) return
    void ipcApi
      .request('notification.mark_conversation_viewed', { conversationType: activeType, conversationId: activeId })
      .catch((error) => logger.error('Failed to mark conversation viewed', error as Error))
  }, [activeType, activeId])

  useEffect(() => {
    reportViewed()
    window.addEventListener('focus', reportViewed)
    return () => window.removeEventListener('focus', reportViewed)
  }, [reportViewed])

  useIpcOn('notification.conversation', (notification) => {
    if (activeTab && findConversationTab([activeTab], notification.meta)) {
      reportViewed()
      return
    }

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
            title: notification.conversationName
          })
          .catch((error) => logger.error('Failed to open conversation from notification', error as Error))
      }
    })
  })

  return null
}
