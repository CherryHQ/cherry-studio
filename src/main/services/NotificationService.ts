import { BrowserWindow, Notification as ElectronNotification } from 'electron'
import { Notification } from 'src/renderer/src/types/notification'

class NotificationService {
  private window: BrowserWindow

  constructor(window: BrowserWindow) {
    // Initialize the service
    this.window = window
  }

  public async sendNotification(notification: Notification) {
    // 使用 Electron Notification API
    const electronNotification = new ElectronNotification({
      title: notification.title,
      body: notification.message
    })

    electronNotification.on('click', () => {
      this.window.show()
      this.window.webContents.send('notification-click', notification)
    })

    electronNotification.show()
  }
}

export default NotificationService
