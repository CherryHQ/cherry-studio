import { ipcRenderer, type IpcRendererEvent } from 'electron'

import type { IpcResult } from '@shared/ipc/errors/IpcError'
import { IpcChannel } from '@shared/IpcChannel'

/**
 * Low-level IpcApi bridge exposed at `window.api.ipcApi`.
 *
 * Generic by design: adding a request route or an event needs ZERO changes here.
 * All events share the single `IpcApi_Event` channel and are demultiplexed by
 * name. The typed, error-unwrapping facade lives in `src/renderer/ipc`; this is
 * the raw transport that crosses the contextBridge.
 */
export const ipcApi = {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw contextBridge input is validated by main's route schema; optional trace metadata is forwarded opaquely and currently ignored by main.
  request: (route: string, input?: unknown, meta?: unknown): Promise<IpcResult<unknown>> =>
    ipcRenderer.invoke(IpcChannel.IpcApi_Request, route, input, meta),

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Renderer subscribers receive event-specific payloads through this generic transport; their typed facade owns the event contract.
  on: (event: string, callback: (payload: unknown) => void): (() => void) => {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Electron delivers the raw multiplexed IpcApi_Event payload; filter its event name before forwarding without asserting a domain shape.
    const listener = (_e: IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) callback(payload)
    }
    ipcRenderer.on(IpcChannel.IpcApi_Event, listener)
    return () => ipcRenderer.removeListener(IpcChannel.IpcApi_Event, listener)
  }
}
