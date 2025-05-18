import { ElectronAPI } from '@electron-toolkit/preload'

import type { WindowApiType } from './index'

/** you don't need to declare this in your code, it's automatically generated */
declare global {
  interface Window {
    electron: ElectronAPI
    api: WindowApiType
  }
}

interface Api {
  getAppInfo: () => Promise<{
    version: string
    appDataPath: string
    electronVersion: string
    isAppImage: boolean
    appVersion: string
    appPath: string
    getSystemVersion: string
    isMac: boolean
    isWindows: boolean
    isLinux: boolean
    getSystemLanguage: string
  }>
  reload: () => void
  setProxy: (proxy: string | undefined) => Promise<boolean>

  // ... other methods ...

  selectAppDataPath: () => Promise<{ success: boolean; path?: string; error?: string }>
  setAppDataPath: (path: string) => Promise<{ success: boolean; error?: string }>
  copyUserData: (oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>
  relaunchApp: () => void
}
