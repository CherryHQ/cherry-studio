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

/**
 * Tab saved state for hibernation recovery
 */
export interface TabSavedState {
  scrollPosition?: number
  // 其他必要草稿字段可在此扩展
}

export interface Tab {
  id: string
  type: TabType
  url: string
  title: string
  icon?: string
  metadata?: Record<string, unknown>
  // LRU 字段
  lastAccessTime?: number // open/switch 时更新
  isDormant?: boolean // 是否已休眠
  isPinned?: boolean // 是否置顶（豁免 LRU）
  savedState?: TabSavedState // 休眠前保存的状态
}

export interface TabsState {
  tabs: Tab[]
  activeTabId: string
}
