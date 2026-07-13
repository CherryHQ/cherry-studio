import NotificationService from '@main/services/NotificationService'
import type { notificationRequestSchemas } from '@shared/ipc/schemas/notification'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Notification request handler. NotificationService is a plain, non-lifecycle class, so a
 * single module-level instance backs the route (it holds no state — each `sendNotification`
 * builds and shows one Electron notification). The click reply travels back as the
 * `notification.clicked` event, broadcast from the service itself.
 */
const notificationService = new NotificationService()

export const notificationHandlers: IpcHandlersFor<typeof notificationRequestSchemas> = {
  'notification.send': async (notification) => {
    await notificationService.sendNotification(notification)
  }
}
