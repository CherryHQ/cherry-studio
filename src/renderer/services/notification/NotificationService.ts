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
      knowledge: 'app.notification.knowledge.enabled'
    })

    // TODO(notification): sources without a configured preference key (e.g. 'update')
    // are silently dropped here — there is no `app.notification.update.enabled`
    // preference, so update notifications never fire. Add a real preference/default
    // policy for such sources, or remove the dead path, in a follow-up.
    if (notificationSettings[notification.source]) {
      void ipcApi.request('notification.send', notification)
    }
  }
}

export const notificationService = new NotificationService()
