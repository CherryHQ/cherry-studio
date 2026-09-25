import type { ElectronAPI } from '@electron-toolkit/preload'

import type { WindowApiType } from './preload'

/** you don't need to declare this in your code, it's automatically generated */
declare global {
  const __UAR_ENABLED__: boolean

  interface Window {
    electron: ElectronAPI
    api: WindowApiType
  }
}
