// Browser stand-in for `electron` in the Worker: the one page that owns the Worker is the only
// window. `ipcMain` handlers run for the page's `ipcRenderer` calls (see `src/page/electron.ts`),
// and `webContents.send` reaches the page; other Electron APIs are not exported, so a new use
// fails the build.
import { PageChannel } from '../worker/protocol'

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
type EventListener = (event: IpcMainEvent, ...args: unknown[]) => void

const handlers = new Map<string, InvokeHandler>()
const listeners = new Map<string, Set<EventListener>>()
let deliverToPage: (channel: string, args: unknown[]) => void = () => {}

// The page lives as long as its Worker, so the window events desktop code listens for never fire.
const inertEvents = {
  on() {
    return this
  },
  once() {
    return this
  },
  removeListener() {
    return this
  }
}

/** The page's `webContents`; `send` delivers to the page once `connectPage` has run. */
export const pageWebContents = {
  id: 1,
  send: (channel: string, ...args: unknown[]) => deliverToPage(channel, args),
  isDestroyed: () => false,
  getType: () => 'window' as const,
  ...inertEvents
}

const pageWindow = {
  id: 1,
  webContents: pageWebContents,
  ...inertEvents,
  isDestroyed: () => false,
  // A tab cannot hide or raise itself; the renderer covers its own content while it is quiesced.
  show() {},
  hide() {},
  focus() {},
  async loadURL(url: string): Promise<void> {
    deliverToPage(PageChannel.LoadUrl, [url])
  }
}

export type PageWebContents = typeof pageWebContents
export type PageWindow = typeof pageWindow

export interface IpcMainEvent {
  sender: PageWebContents
  senderFrame: { url: string }
}
export type IpcMainInvokeEvent = IpcMainEvent

/** The channels the Worker handles or listens on; the harness reports them to the test of what the renderer calls. */
export function handledChannels(): string[] {
  return [...handlers.keys(), ...listeners.keys()]
}

export const ipcMain = {
  handle(channel: string, handler: InvokeHandler): void {
    if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`)
    handlers.set(channel, handler)
  },
  removeHandler(channel: string): void {
    handlers.delete(channel)
  },
  on(channel: string, listener: EventListener): void {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel)!.add(listener)
  },
  removeListener(channel: string, listener: EventListener): void {
    listeners.get(channel)?.delete(listener)
  }
}

export const BrowserWindow = {
  getAllWindows: () => [pageWindow],
  fromId: (id: number) => (id === pageWindow.id ? pageWindow : null),
  fromWebContents: (webContents: unknown) => (webContents === pageWebContents ? pageWindow : null)
}

const appApi = {
  getLocale: () => navigator.language,
  relaunch: () => deliverToPage(PageChannel.Relaunch, []),
  whenReady: () => Promise.resolve()
}

/** Requests leave from the Worker; the browser applies its own proxy settings. */
export const net = {
  fetch: (input: string | Request, init?: RequestInit) => fetch(input, init)
}

export const shell = {
  async openExternal(url: string): Promise<void> {
    deliverToPage(PageChannel.OpenExternal, [url])
  }
}

export const app = new Proxy(appApi, {
  get(target, property) {
    if (typeof property === 'string' && property in target) return target[property as keyof typeof target]
    throw new Error(`electron app.${String(property)} is not available in the Web Core Worker`)
  }
})

/** Routes `webContents.send` to the page and returns the page's IPC entry points. */
export function connectPage(deliver: (channel: string, args: unknown[]) => void) {
  deliverToPage = deliver
  const event: IpcMainEvent = { sender: pageWebContents, senderFrame: { url: self.location.href } }
  return {
    invoke(channel: string, args: unknown[]): Promise<unknown> {
      const handler = handlers.get(channel)
      if (!handler) return Promise.reject(new Error(`No handler registered for '${channel}'`))
      return Promise.resolve().then(() => handler(event, ...args))
    },
    send(channel: string, args: unknown[]): void {
      for (const listener of listeners.get(channel) ?? []) listener(event, ...args)
    }
  }
}
