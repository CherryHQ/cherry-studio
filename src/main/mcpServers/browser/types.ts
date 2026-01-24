import { loggerService } from '@logger'
import { generateUserAgent } from '@main/utils/systemInfo'
import type { BrowserView, BrowserWindow } from 'electron'

export const logger = loggerService.withContext('MCPBrowserCDP')
export const userAgent = generateUserAgent()

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
  tabBarView?: BrowserView
}
