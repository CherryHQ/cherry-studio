import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error('[Preload]Failed to expose APIs:', error as Error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
}
