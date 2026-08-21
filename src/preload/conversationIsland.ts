import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const ipcApi = {
  request: (route: string, input?: unknown, meta?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('ipc-api:request', route, input, meta),
  on: (event: string, callback: (payload: unknown) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) callback(payload)
    }
    ipcRenderer.on('ipc-api:event', listener)
    return () => ipcRenderer.removeListener('ipc-api:event', listener)
  }
}

contextBridge.exposeInMainWorld('api', { ipcApi })
