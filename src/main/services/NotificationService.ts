import { application } from '@application'
import { WindowType } from '@main/core/window/types'
import type { Notification } from '@shared/types/notification'
import { Notification as ElectronNotification } from 'electron'

class NotificationService {
  public async sendNotification(notification: Notification) {
    // 使用 Electron Notification API
    const electronNotification = new ElectronNotification({
      title: notification.title,
      body: notification.message
    })

    electronNotification.on('click', () => {
      application.get('MainWindowService').showMainWindow()
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'notification.clicked', notification)
    })

    electronNotification.show()
  }
}

export default NotificationService
