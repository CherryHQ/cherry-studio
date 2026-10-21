import { WindowType } from '@main/core/window/types'

import { BrowserWindow, type PageWindow, pageWebContents } from '../runtime/electron'

/** The page's id among the desktop's window ids; the page is the main window. */
export const PAGE_WINDOW_ID = 'main'

/** The desktop `WindowManager`'s lookup and broadcast API over the Worker's single page window. */
export class WebWindowManager {
  getWindow(windowId: string): PageWindow | undefined {
    return windowId === PAGE_WINDOW_ID ? BrowserWindow.getAllWindows()[0] : undefined
  }

  getWindowIdByWebContents(webContents: unknown): string | undefined {
    return webContents === pageWebContents ? PAGE_WINDOW_ID : undefined
  }

  getWindowsByType(type: WindowType): PageWindow[] {
    return type === WindowType.Main ? BrowserWindow.getAllWindows() : []
  }

  broadcast(channel: string, ...args: unknown[]): void {
    pageWebContents.send(channel, ...args)
  }

  broadcastToType(type: WindowType, channel: string, ...args: unknown[]): void {
    if (type === WindowType.Main) pageWebContents.send(channel, ...args)
  }
}
