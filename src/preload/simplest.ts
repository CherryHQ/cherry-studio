import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'

import { ipcApi } from './ipc'

const api = { ipcApi }

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('[Preload]Failed to expose APIs:', error as Error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore This preboot preload intentionally exposes only the IpcApi bridge.
  window.api = api
}
