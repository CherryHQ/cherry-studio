import { IpcChannel } from '@shared/IpcChannel'
import type { Notification } from '@types'
import { ipcRenderer } from 'electron'

export const notificationApi = {
  notification: {
    send: (notification: Notification) => ipcRenderer.invoke(IpcChannel.Notification_Send, notification)
  }
}
