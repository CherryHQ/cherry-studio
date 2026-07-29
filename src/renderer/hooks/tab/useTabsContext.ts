import type { Tab, TabType } from '@shared/data/cache/cacheValueTypes'
import { createContext, use } from 'react'

/**
 * Options for opening a tab
 */
export interface OpenTabOptions {
  /** Force open a new tab even if one with the same URL exists */
  forceNew?: boolean
  /** Tab title (defaults to URL path) */
  title?: string
  /** Tab type (defaults to 'route') */
  type?: TabType
  /** Custom tab ID (auto-generated if not provided) */
  id?: string
  /** Per-entity icon descriptor (e.g. mini-app logo string); rendered in the tab bar when set */
  icon?: string
  /** Optional tab metadata copied into the newly-created tab. */
  metadata?: Tab['metadata']
  /**
   * Materialize the tab as pinned. Set when a detached sub-window re-creates a tab
   * from its init payload so the pinned state survives the detach → re-attach round-trip.
   */
  isPinned?: boolean
}

export interface TabsContextValue {
  // State
  tabs: Tab[]
  activeTabId: string
  activeTab: Tab | undefined
  isLoading: boolean

  // Basic operations
  addTab: (tab: Tab) => void
  closeTab: (id: string) => void
  /** Close tabs in one batch; `activateId` designates the surviving tab to activate when the active tab is closed. */
  closeTabs: (ids: readonly string[], activateId?: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, updates: Partial<Tab>) => void

  // High-level Tab operations
  openTab: (url: string, options?: OpenTabOptions) => string

  // Pin operations
  pinTab: (id: string) => void
  unpinTab: (id: string) => void

  // Drag and drop
  reorderTabs: (type: 'pinned' | 'normal', oldIndex: number, newIndex: number) => void

  // Detach
  detachTab: (tabId: string) => void

  // Attach (from detached window)
  attachTab: (tabData: Tab) => void
}

export const TabsContext = createContext<TabsContextValue | null>(null)

export function useTabsContext() {
  const context = use(TabsContext)
  if (!context) {
    throw new Error('useTabsContext must be used within a TabsProvider')
  }
  return context
}

export function useOptionalTabsContext() {
  return use(TabsContext)
}
