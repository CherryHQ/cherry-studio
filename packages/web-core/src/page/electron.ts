import type { IpcRoute } from '@shared/ipc/schemas/ipcSchemas'
import type { InputFor, OutputFor } from '@shared/ipc/types'
// Browser stand-in for `electron` in the page: `ipcRenderer` reaches the Core Worker's `ipcMain`
// (see `src/runtime/electron.ts`) once `connectCore` has run. Only what the desktop preload uses
// is exported, so a new Electron API in the preload fails the build.
import { IpcChannel } from '@shared/IpcChannel'

import type { CoreClient } from '../client/CoreClient'
import { PageChannel } from '../worker/protocol'

type IpcRendererListener = (event: IpcRendererEvent, ...args: any[]) => void

export interface IpcRendererEvent {
  sender: typeof ipcRenderer
  ports: MessagePort[]
}

const listeners = new Map<string, Set<IpcRendererListener>>()
const pageHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
const pageRoutes = new Map<string, (input: unknown) => unknown>()
let connect: (client: CoreClient) => void
// Calls made before the page connects (e.g. logging while modules load) wait for the Worker.
const core = new Promise<CoreClient>((resolve) => (connect = resolve))

export const ipcRenderer = {
  async invoke(channel: string, ...args: unknown[]): Promise<any> {
    // Runs in the caller's click, before any await, so it can open browser dialogs.
    const pageHandler = pageHandlers.get(channel)
    if (pageHandler) return pageHandler(...args)
    const pageRoute = channel === IpcChannel.IpcApi_Request ? pageRoutes.get(args[0] as string) : undefined
    // The envelope `IpcApiService` answers with.
    if (pageRoute) return { ok: true, data: await pageRoute(args[1]) }
    try {
      return await (await core).send('ipc-invoke', { channel, args })
    } catch (error) {
      // Electron's wording, which callers may match on.
      throw new Error(`Error invoking remote method '${channel}': ${error}`)
    }
  },
  send(channel: string, ...args: unknown[]): void {
    // A throwing `ipcMain.on` listener is an uncaught error in Electron's main process.
    core.then((client) => client.send('ipc-send', { channel, args })).catch(reportError)
  },
  on(channel: string, listener: IpcRendererListener) {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel)!.add(listener)
    return ipcRenderer
  },
  once(channel: string, listener: IpcRendererListener) {
    const onceListener: IpcRendererListener = (event, ...args) => {
      ipcRenderer.removeListener(channel, onceListener)
      listener(event, ...args)
    }
    return ipcRenderer.on(channel, onceListener)
  },
  removeListener(channel: string, listener: IpcRendererListener) {
    listeners.get(channel)?.delete(listener)
    return ipcRenderer
  },
  off(channel: string, listener: IpcRendererListener) {
    return ipcRenderer.removeListener(channel, listener)
  },
  removeAllListeners(channel?: string) {
    if (channel) listeners.delete(channel)
    else listeners.clear()
    return ipcRenderer
  }
}

/** Delivers `channel` to the page's `ipcRenderer.on` listeners, as the main process's `webContents.send` does. */
export function sendToPage(channel: string, args: unknown[]): void {
  const event: IpcRendererEvent = { sender: ipcRenderer, ports: [] }
  for (const listener of [...(listeners.get(channel) ?? [])]) listener(event, ...args)
}

/** Connects `ipcRenderer` to the page's Core Worker; the Worker's `webContents.send` reaches `on` listeners. */
export function connectCore(client: CoreClient): void {
  client.onBroadcast((channel, args) => {
    if (channel === PageChannel.Relaunch) location.reload()
    else if (channel === PageChannel.OpenExternal) void shell.openExternal(args[0] as string)
    sendToPage(channel, args)
  })
  connect(client)
}

/** Answers `ipcRenderer.invoke(channel)` in the page, for what only the page can do, such as browser dialogs. */
export function handleInPage(channel: string, handler: (...args: unknown[]) => Promise<unknown>): void {
  pageHandlers.set(channel, handler)
}

/** Answers an IpcApi route in the page, for what needs the browser window or the caller's click. */
export function answerInPage<R extends IpcRoute>(
  route: R,
  answer: (input: InputFor<R>) => OutputFor<R> | Promise<OutputFor<R>>
): void {
  pageRoutes.set(route, answer as (input: unknown) => unknown)
}

export const contextBridge = {
  exposeInMainWorld(key: string, api: unknown): void {
    ;(globalThis as Record<string, unknown>)[key] = api
  }
}

export const shell = {
  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

// Files picked in a browser have no path on disk; Electron also returns '' for those.
export const webUtils = {
  getPathForFile: () => ''
}
