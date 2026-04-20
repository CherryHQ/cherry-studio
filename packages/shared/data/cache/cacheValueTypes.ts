import type { MinAppType, Topic } from '@types'
import type { UpdateInfo } from 'builder-util-runtime'

import type { WebSearchStatus } from '../types/webSearch'

export type CacheAppUpdateState = {
  info: UpdateInfo | null
  checking: boolean
  downloading: boolean
  downloaded: boolean
  downloadProgress: number
  available: boolean
  ignore: boolean
  //   /** Whether the update check was manually triggered by user clicking the button */
  manualCheck: boolean
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
 * Split-view layout types (recursive tree structure)
 */
export type SplitDirection = 'horizontal' | 'vertical'

export interface SplitPane {
  type: 'leaf'
  paneId: string
  url: string
  title: string
  /**
   * Preview pane: passively opened (e.g. by following a link/reference).
   * At most one preview pane per Tab. Replaced in-place when another preview
   * opens. Promoted to persistent (isPreview = false) when the user navigates
   * within it, double-clicks the header, or drags it.
   */
  isPreview?: boolean
}

export interface SplitNode {
  type: 'split'
  direction: SplitDirection
  /** 0-100 percentage for the first child */
  ratio: number
  children: [SplitLayout, SplitLayout]
}

export type SplitLayout = SplitPane | SplitNode

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
  // Split-view fields
  splitLayout?: SplitLayout // undefined = single view (backward compatible)
  activePaneId?: string // which pane has focus within a split tab
}

export interface TabsState {
  tabs: Tab[]
  activeTabId: string
}

// ============================================================================
// Pane-First Layout (Phase 2, Obsidian-style recursive pane tree)
// ============================================================================

export type PaneDirection = 'horizontal' | 'vertical'

/**
 * A single tab inside a leaf pane. Successor to Tab, minus the nested split
 * fields (splitLayout/activePaneId) that are now expressed at the tree level.
 */
export interface PaneTab {
  id: string
  type: TabType
  url: string
  title: string
  icon?: string
  metadata?: Record<string, unknown>
  lastAccessTime?: number
  isDormant?: boolean
  isPinned?: boolean
  savedState?: TabSavedState
}

export interface LeafPane {
  type: 'leaf'
  paneId: string
  tabs: PaneTab[]
  /** Must reference a tab in `tabs` (enforced by normalize). */
  activeTabId: string
}

export interface PaneSplitNode {
  type: 'split'
  direction: PaneDirection
  /** 0-100 percentage for the first child. */
  ratio: number
  children: [PaneLayout, PaneLayout]
}

export type PaneLayout = LeafPane | PaneSplitNode

export interface PanesState {
  root: PaneLayout
  /** Must be the paneId of an existing leaf (enforced by normalize). */
  activePaneId: string
}

export type TranslatingState =
  | {
      isTranslating: true
      abortKey: string
    }
  | {
      isTranslating: false
      abortKey: null
    }
