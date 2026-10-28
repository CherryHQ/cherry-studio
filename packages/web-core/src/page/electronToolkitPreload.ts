// Browser stand-in for `@electron-toolkit/preload`, the `window.electron` object the renderer reads.
// The renderer only uses `invoke`, `send` and `on` of its `ipcRenderer`.
import type { ElectronAPI } from '@electron-toolkit/preload'

import { ipcRenderer, type IpcRendererEvent } from './electron'

type IpcRendererListener = (event: IpcRendererEvent, ...args: any[]) => void

export function platform(): 'win32' | 'darwin' | 'linux' {
  const userAgent = navigator.userAgent
  if (/Windows/.test(userAgent)) return 'win32'
  if (/Mac OS X|Macintosh/.test(userAgent)) return 'darwin'
  return 'linux'
}

const toolkitIpcRenderer = {
  invoke: ipcRenderer.invoke,
  send: ipcRenderer.send,
  // The toolkit's `on` / `once` return an unsubscribe function instead of `ipcRenderer`.
  on(channel: string, listener: IpcRendererListener) {
    ipcRenderer.on(channel, listener)
    return () => void ipcRenderer.removeListener(channel, listener)
  },
  once(channel: string, listener: IpcRendererListener) {
    ipcRenderer.once(channel, listener)
    return () => void ipcRenderer.removeListener(channel, listener)
  },
  removeListener(channel: string, listener: IpcRendererListener) {
    ipcRenderer.removeListener(channel, listener)
    return toolkitIpcRenderer
  },
  removeAllListeners: (channel: string) => void ipcRenderer.removeAllListeners(channel)
}

export const electronAPI: Pick<ElectronAPI, 'ipcRenderer' | 'process'> = {
  ipcRenderer: toolkitIpcRenderer as unknown as ElectronAPI['ipcRenderer'],
  process: { platform: platform(), versions: {}, env: {} }
}
