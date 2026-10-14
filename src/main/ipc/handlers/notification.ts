import { application } from '@application'
import type { notificationRequestSchemas } from '@shared/ipc/schemas/notification'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Notification request handlers. The main-process NotificationService owns system delivery;
 * handlers stay transport-only.
 */
export const notificationHandlers: IpcHandlersFor<typeof notificationRequestSchemas> = {
  'notification.send': async (notification) => {
    await application.get('NotificationService').sendNotification(notification)
  }
}
