// Browser stand-in for `electron` in the Worker: the one page that owns the Worker is the only
// window. `ipcMain` handlers run for the page's `ipcRenderer` calls (see `src/page/electron.ts`),
// and `webContents.send` reaches the page; other Electron APIs are not exported, so a new use
// fails the build.
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
type EventListener = (event: IpcMainEvent, ...args: unknown[]) => void

const handlers = new Map<string, InvokeHandler>()
const listeners = new Map<string, Set<EventListener>>()
let deliverToPage: (channel: string, args: unknown[]) => void = () => {}

/** The page's `webContents`; `send` delivers to the page once `connectPage` has run. */
export const pageWebContents = {
  id: 1,
  send: (channel: string, ...args: unknown[]) => deliverToPage(channel, args),
  isDestroyed: () => false,
  getType: () => 'window' as const
}

const pageWindow = { id: 1, webContents: pageWebContents, isDestroyed: () => false }

export type PageWebContents = typeof pageWebContents
export type PageWindow = typeof pageWindow

export interface IpcMainEvent {
  sender: PageWebContents
  senderFrame: { url: string }
}
export type IpcMainInvokeEvent = IpcMainEvent

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

const appApi: Record<string, unknown> = {
  getLocale: () => navigator.language
}

export const app = new Proxy(appApi, {
  get(target, property) {
    if (typeof property === 'string' && property in target) return target[property]
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
