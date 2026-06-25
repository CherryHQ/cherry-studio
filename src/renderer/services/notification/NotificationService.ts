import { preferenceService } from '@data/PreferenceService'
import type { Notification } from '@renderer/types/notification'

export class NotificationService {
  constructor() {
    this.setupNotificationClickHandler()
  }

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

    if (notificationSettings[notification.source]) {
      void window.api.notification.send(notification)
    }
  }

  /**
   * 设置通知点击事件处理
   */
  private setupNotificationClickHandler(): void {
    // Register an event listener for notification clicks
    window.electron.ipcRenderer.on('notification-click', (_event, notification: Notification) => {
      // 根据通知类型处理点击事件
      if (notification.type === 'action') {
        notification.onClick?.()
      }
    })
  }
}

export const notificationService = new NotificationService()
