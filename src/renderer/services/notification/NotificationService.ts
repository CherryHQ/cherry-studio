import { preferenceService } from '@data/PreferenceService'
import { ipcApi } from '@renderer/ipc'
import type { Notification } from '@renderer/types/notification'

export class NotificationService {
  /**
   * 发送通知
   * @param notification 要发送的通知
   */
  public async send(notification: Notification): Promise<void> {
    const notificationSettings = await preferenceService.getMultiple({
      assistant: 'app.notification.assistant.enabled',
      backup: 'app.notification.backup.enabled',
      knowledge: 'app.notification.knowledge.enabled',
      update: 'app.notification.update.enabled'
    })

    if (notificationSettings[notification.source]) {
      void ipcApi.request('notification.send', notification)
    }
  }
}

export const notificationService = new NotificationService()
