import { IpcChannel } from '@shared/IpcChannel'
import { ipcRenderer, type IpcRendererEvent } from 'electron'

/**
 * Low-level IpcApi bridge exposed at `window.api.ipcApi`.
 *
 * Generic by design: adding a request route or an event needs ZERO changes here.
 * All events share the single `IpcApi_Event` channel and are demultiplexed by
 * name. The typed, error-unwrapping facade lives in `src/renderer/ipc`; this is
 * the raw transport that crosses the contextBridge.
 */
export const ipcApi = {
  request: (route: string, input?: unknown, meta?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannel.IpcApi_Request, route, input, meta),

  on: (event: string, callback: (payload: unknown) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) callback(payload)
    }
    ipcRenderer.on(IpcChannel.IpcApi_Event, listener)
    return () => ipcRenderer.removeListener(IpcChannel.IpcApi_Event, listener)
  }
}
