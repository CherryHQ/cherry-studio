// Browser stand-in for `electron` in the page: `ipcRenderer` reaches the Core Worker's `ipcMain`
// (see `src/runtime/electron.ts`) once `connectCore` has run. Only what the desktop preload uses
// is exported, so a new Electron API in the preload fails the build.
import type { CoreClient } from '../client/CoreClient'
import { PageChannel } from '../worker/protocol'

type IpcRendererListener = (event: IpcRendererEvent, ...args: any[]) => void

export interface IpcRendererEvent {
  sender: typeof ipcRenderer
  ports: MessagePort[]
}

const listeners = new Map<string, Set<IpcRendererListener>>()
let connect: (client: CoreClient) => void
// Calls made before the page connects (e.g. logging while modules load) wait for the Worker.
const core = new Promise<CoreClient>((resolve) => (connect = resolve))

export const ipcRenderer = {
  async invoke(channel: string, ...args: unknown[]): Promise<any> {
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

/** Connects `ipcRenderer` to the page's Core Worker; the Worker's `webContents.send` reaches `on` listeners. */
export function connectCore(client: CoreClient): void {
  const event: IpcRendererEvent = { sender: ipcRenderer, ports: [] }
  client.onBroadcast((channel, args) => {
    if (channel === PageChannel.Relaunch) location.reload()
    else if (channel === PageChannel.OpenExternal) void shell.openExternal(args[0] as string)
    for (const listener of [...(listeners.get(channel) ?? [])]) listener(event, ...args)
  })
  connect(client)
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
