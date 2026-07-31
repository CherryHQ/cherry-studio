import { application } from '@application'
import type { notificationRequestSchemas } from '@shared/ipc/schemas/notification'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Notification request handlers. The main-process NotificationService owns system delivery
 * and the cross-window task-target registry; handlers stay transport-only.
 */
export const notificationHandlers: IpcHandlersFor<typeof notificationRequestSchemas> = {
  'notification.send': async (notification) => {
    await application.get('NotificationService').sendNotification(notification)
  },
  'notification.sync_task_targets': async ({ targets }, { senderId }) => {
    if (!senderId) return
    application.get('NotificationService').syncTaskTargets(senderId, targets)
  },
  'notification.focus_task_target': async (target, { senderId }) => {
    return application.get('NotificationService').focusTaskTarget(target, senderId)
  }
}
