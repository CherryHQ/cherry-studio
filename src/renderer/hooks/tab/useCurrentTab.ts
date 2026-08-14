import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { createContext, use } from 'react'

import { useOptionalTabsContext } from './useTabsContext'

/**
 * Provides the id of the tab that owns the content rendered beneath it.
 *
 * All non-dormant tabs mount simultaneously (React 19 `Activity` keep-alive in
 * {@link import('../../components/layout/TabRouter').TabRouter}), so a page cannot
 * rely on `useTabs().activeTab` to identify itself — that points at the globally
 * active tab. A page reads its OWN id from here.
 */
export const TabIdContext = createContext<string | null>(null)

/** The owning tab's id, or null when rendered outside a tab (e.g. tests). */
export function useCurrentTabId(): string | null {
  return use(TabIdContext)
}

export function useCurrentTab(): Tab | undefined {
  const currentTabId = useCurrentTabId()
  return useOptionalTabsContext()?.tabs.find((tab) => tab.id === currentTabId)
}

/**
 * True when this tab is the globally-focused one. Gates "last used" writes so background
 * tabs (also mounted under keep-alive) don't clobber the single global value.
 */
export function useIsActiveTab(): boolean {
  const currentTabId = useCurrentTabId()
  const activeTabId = useOptionalTabsContext()?.activeTabId
  return !!currentTabId && currentTabId === activeTabId
}
