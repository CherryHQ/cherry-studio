import { ElectronAPI } from '@electron-toolkit/preload'

import type { WindowApiType } from './index'

/** you don't need to declare this in your code, it's automatically generated */
declare global {
  interface Window {
    electron: ElectronAPI
    api: WindowApiType
  }
}
