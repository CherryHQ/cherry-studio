import { emojiTabIcon } from '@renderer/components/layout/tabIcons'
import { useOptionalTabsContext } from '@renderer/context/TabsContext'
import { createContext, type ReactNode, use, useEffect, useRef } from 'react'

/**
 * Provides the id of the tab that owns the content rendered beneath it.
 *
 * All non-dormant tabs mount simultaneously (React 19 `Activity` keep-alive in
 * {@link import('../components/layout/TabRouter').TabRouter}), so a page cannot
 * rely on `useTabs().activeTab` to identify itself — that points at the globally
 * active tab. A page reads its OWN id from here.
 */
const TabIdContext = createContext<string | null>(null)

export function TabIdProvider({ tabId, children }: { tabId: string; children: ReactNode }) {
  return <TabIdContext value={tabId}>{children}</TabIdContext>
}

/** The owning tab's id, or null when rendered outside a tab (e.g. tests). */
export function useCurrentTabId(): string | null {
  return use(TabIdContext)
}

export interface TabSelfMetadata {
  title: string
  emoji?: string | null
  isTemporary: boolean
}

/**
 * Sync this tab's own title / icon / isTemporary into the tab model. The owning page
 * passes its derived metadata; everything tab-specific (emoji → icon descriptor mapping,
 * which tab id, change dedupe) stays here so the page never touches the tab system or the
 * `Tab` shape. No-op without a TabsProvider / TabIdProvider (tests, detached popups).
 */
export function useTabSelfMetadata({ title, emoji, isTemporary }: TabSelfMetadata): void {
  const currentTabId = useCurrentTabId()
  const updateTab = useOptionalTabsContext()?.updateTab
  const signatureRef = useRef<string>('')

  useEffect(() => {
    if (!currentTabId || !updateTab) return
    const icon = emojiTabIcon(emoji)
    const signature = `${title} ${icon ?? ''} ${isTemporary}`
    if (signature === signatureRef.current) return
    signatureRef.current = signature
    updateTab(currentTabId, { title, icon, isTemporary })
  }, [currentTabId, updateTab, title, emoji, isTemporary])
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
