import { application } from '@application'
import type { Notification } from '@types'
import { Notification as ElectronNotification } from 'electron'

class NotificationService {
  public async sendNotification(notification: Notification) {
    // 使用 Electron Notification API
    const electronNotification = new ElectronNotification({
      title: notification.title,
      body: notification.message
    })

    electronNotification.on('click', () => {
      application.get('WindowService').getMainWindow()?.show()
      application.get('WindowService').getMainWindow()?.webContents.send('notification-click', notification)
    })

    electronNotification.show()
  }
}

export default NotificationService
