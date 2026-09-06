import { loggerService } from '@logger'
import type { BrowserView, BrowserWindow } from 'electron'

export const logger = loggerService.withContext('McpBrowserCDP')
export const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

import type { GuestSession } from '../session/GuestSession'

export interface TabInfo {
  session: GuestSession
  ready: Promise<void>
  popup?: Promise<string | undefined>
  id: string
  view: BrowserView
  url: string
  title: string
}

export interface WindowInfo {
  windowKey: string
  privateMode: boolean
  window: BrowserWindow
  /** WindowManager id for this window — close via wm.close(windowId) */
  windowId: string
  tabs: Map<string, TabInfo>
  activeTabId: string | null
  tabBarView?: BrowserView
}
