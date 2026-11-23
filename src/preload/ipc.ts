import { ipcRenderer, type IpcRendererEvent } from 'electron'

import { IpcChannel } from '@shared/IpcChannel'

/**
 * Low-level IpcApi bridge exposed at `window.api.ipcApi`.
 *
 * Generic by design: adding a request route or an event needs ZERO changes here.
 * All events share the single `IpcApi_Event` channel and are demultiplexed by
 * name. The typed, error-unwrapping facade lives in `src/renderer/ipc`; this is
 * the raw transport that crosses the contextBridge.
 */
const subscribers = new Map<string, Set<(payload: unknown) => void>>()
let listening = false

// One channel listener for every subscriber; one each tripped MaxListenersExceededWarning past ten.
function dispatch(_e: IpcRendererEvent, name: string, payload: unknown) {
  for (const callback of [...(subscribers.get(name) ?? [])]) callback(payload)
}

export const ipcApi = {
  request: (route: string, input?: unknown, meta?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannel.IpcApi_Request, route, input, meta),

  on: (event: string, callback: (payload: unknown) => void): (() => void) => {
    if (!listening) {
      ipcRenderer.on(IpcChannel.IpcApi_Event, dispatch)
      listening = true
    }
    const callbacks = subscribers.get(event) ?? new Set()
    subscribers.set(event, callbacks)
    // A wrapper keeps a callback subscribed twice as two subscriptions.
    const subscription = (payload: unknown) => callback(payload)
    callbacks.add(subscription)
    return () => {
      callbacks.delete(subscription)
      if (callbacks.size === 0 && subscribers.get(event) === callbacks) subscribers.delete(event)
    }
  }
}
