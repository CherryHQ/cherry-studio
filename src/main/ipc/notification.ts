import { IpcChannel } from '@shared/IpcChannel'
import type { Notification } from '@types'
import { BrowserWindow, ipcMain } from 'electron'

import NotificationService from '../services/NotificationService'

export function registerNotificationIpc(mainWindow: BrowserWindow) {
  const notificationService = new NotificationService()

  ipcMain.handle(IpcChannel.Notification_Send, async (_, notification: Notification) => {
    await notificationService.sendNotification(notification)
  })
  ipcMain.handle(IpcChannel.Notification_OnClick, (_, notification: Notification) => {
    mainWindow.webContents.send('notification-click', notification)
  })
}
