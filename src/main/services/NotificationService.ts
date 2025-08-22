import { Notification as ElectronNotification } from 'electron'
import { Notification } from 'src/renderer/src/types/notification'

import { windowService } from './WindowService'

class NotificationService {
  public async sendNotification(notification: Notification) {
    // 使用 Electron Notification API
    const electronNotification = new ElectronNotification({
      title: notification.title,
      body: notification.message
    })

    electronNotification.on('click', () => {
      windowService.getMainWindow()?.show()
      windowService.getMainWindow()?.webContents.send('notification-click', notification)
    })

    electronNotification.show()
  }
}

export default NotificationService
