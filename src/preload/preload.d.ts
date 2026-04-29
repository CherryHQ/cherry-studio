import type { ElectronAPI } from '@electron-toolkit/preload'

import type { WindowApiType } from './index'

/** you don't need to declare this in your code, it's automatically generated */
declare global {
  interface Window {
    electron: ElectronAPI & {
      cacheReminder: {
        playSound: () => Promise<void>
        sendNotification: (topicId: string, topicName: string) => Promise<void>
      }
    }
    api: WindowApiType
  }
}

declare module '@electron-toolkit/preload' {
  interface ElectronAPI {
    cacheReminder: {
      playSound: () => Promise<void>
      sendNotification: (topicId: string, topicName: string) => Promise<void>
    }
  }
}
