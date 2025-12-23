import { loggerService } from '@logger'
import type { BrowserView, BrowserWindow } from 'electron'

export const logger = loggerService.withContext('MCPBrowserCDP')
export const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0'

export interface TabInfo {
  id: string
  view: BrowserView
  url: string
  title: string
  lastActive: number
}

export interface WindowInfo {
  windowKey: string
  privateMode: boolean
  window: BrowserWindow
  tabs: Map<string, TabInfo>
  activeTabId: string | null
  lastActive: number
}
