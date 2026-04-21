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
 * Tab saved state for hibernation recovery
 */
export interface TabSavedState {
  scrollPosition?: number
}

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
