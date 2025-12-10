import type { MinAppType, Topic, WebSearchStatus } from '@types'
import type { UpdateInfo } from 'builder-util-runtime'

export type CacheAppUpdateState = {
  info: UpdateInfo | null
  checking: boolean
  downloading: boolean
  downloaded: boolean
  downloadProgress: number
  available: boolean
  ignore: boolean
}

export type CacheActiveSearches = Record<string, WebSearchStatus>

// For cache schema, we use any for complex types to avoid circular dependencies
// The actual type checking will be done at runtime by the cache system
export type CacheMinAppType = MinAppType
export type CacheTopic = Topic

/**
 * Tab type for browser-like tabs
 *
 * - 'route': Internal app routes rendered via MemoryRouter
 * - 'webview': External web content rendered via Electron webview
 */
export type TabType = 'route' | 'webview'

export interface Tab {
  id: string
  type: TabType
  url: string
  title: string
  icon?: string
  metadata?: Record<string, unknown>
  // TODO: LRU 优化字段，后续添加
  // lastAccessTime?: number
}

export interface TabsState {
  tabs: Tab[]
  activeTabId: string
}
