import { application } from '@application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { Notification } from '@types'
import { Notification as ElectronNotification } from 'electron'

@Injectable('NotificationService')
@ServicePhase(Phase.WhenReady)
export class NotificationService extends BaseService {
  protected async onInit() {
    this.ipcHandle(IpcChannel.Notification_Send, async (_, notification: Notification) => {
      await this.sendNotification(notification)
    })
  }

  public async sendNotification(notification: Notification) {
    // 使用 Electron Notification API
    const electronNotification = new ElectronNotification({
      title: notification.title,
      body: notification.message
    })

    electronNotification.on('click', () => {
      application.get('MainWindowService').showMainWindow()
      application.get('WindowManager').broadcastToType(WindowType.Main, 'notification-click', notification)
    })

    electronNotification.show()
  }
}
