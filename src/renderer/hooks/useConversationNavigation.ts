import {
  emitResourceListReveal,
  type ResourceListRevealSource
} from '@renderer/components/chat/resources/resourceListRevealEvents'
import {
  buildSidebarAppOpenMetadata,
  getSidebarApp,
  getSidebarAppTabInstanceKey,
  tabBelongsToApp
} from '@renderer/config/sidebar'
import { type TabsContextValue, useOptionalTabsContext } from '@renderer/context/TabsContext'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import { useMemo } from 'react'

export interface ConversationNavigation {
  /**
   * Focus the tab already showing conversation `key`; returns true if one was focused.
   * `excludeTabId` skips a tab (the caller's own) so an in-page click can fall through
   * to navigating the current tab instead of bouncing to itself.
   */
  focusExistingTab: (key: string, options?: { excludeTabId?: string }) => boolean
  /**
   * Focus the tab showing `key`, else open a new base-route tab with instance metadata.
   * `forceNew` skips the focus step and always opens a fresh duplicate tab.
   */
  openConversationTab: (key: string, title?: string, options?: { forceNew?: boolean }) => string | undefined
}

/**
 * App-parameterized variant of {@link ConversationNavigation}: same focus/open intents,
 * but the conversation app is chosen per call. Lets a single consumer (e.g. the sidebar)
 * dispatch to any registry conversation app without instantiating one hook per app or
 * branching on `app.id`.
 */
export interface ConversationNavigator {
  focusExistingTab: (appId: SidebarIcon, key: string, options?: { excludeTabId?: string }) => boolean
  openConversationTab: (appId: SidebarIcon, key: string, title?: string) => string | undefined
}

// Only conversation apps that own a resource sidebar emit a reveal on focus/open.
function resolveRevealSource(appId: SidebarIcon): ResourceListRevealSource | null {
  return appId === 'assistants' || appId === 'agents' ? appId : null
}

function findConversationTabId(
  tabs: TabsContextValue | null,
  appId: SidebarIcon,
  key: string,
  excludeTabId?: string
): string | undefined {
  const app = getSidebarApp(appId)
  if (!tabs || !app?.instanceKey) return undefined
  return tabs.tabs.find(
    (tab) =>
      tab.type === 'route' &&
      tab.id !== excludeTabId &&
      tabBelongsToApp(app, tab.url) &&
      getSidebarAppTabInstanceKey(app, tab) === key
  )?.id
}

function focusConversationTabImpl(
  tabs: TabsContextValue | null,
  appId: SidebarIcon,
  key: string,
  excludeTabId?: string
): boolean {
  const id = findConversationTabId(tabs, appId, key, excludeTabId)
  if (!id || !tabs) return false
  tabs.setActiveTab(id)
  const source = resolveRevealSource(appId)
  if (source) emitResourceListReveal({ source, tabId: id })
  return true
}

function openConversationTabImpl(
  tabs: TabsContextValue | null,
  appId: SidebarIcon,
  key: string,
  title?: string,
  forceNew?: boolean
): string | undefined {
  const app = getSidebarApp(appId)
  if (!tabs || !app?.instanceKey) return
  if (!forceNew && focusConversationTabImpl(tabs, appId, key)) return
  const metadata = buildSidebarAppOpenMetadata(app, key)
  const openedId = tabs.openTab(app.routePrefix, { forceNew: true, title, ...(metadata && { metadata }) })
  const source = resolveRevealSource(appId)
  if (openedId && source) emitResourceListReveal({ source, tabId: openedId })
  return openedId
}

/**
 * Single boundary for "navigate to a conversation tab" intents (chat topic / agent
 * session), bound to one app. Built on the SIDEBAR_APPS registry's identity↔url mapping
 * (`instanceKey`), so pages and lists stop touching the tabs context, `openTab`, or url
 * helpers directly.
 *
 * Degrades to no-ops when there is no TabsProvider (tests, detached popups) or when the
 * app has no `instanceKey`.
 */
export function useConversationNavigation(appId: SidebarIcon): ConversationNavigation {
  const tabs = useOptionalTabsContext()

  return useMemo<ConversationNavigation>(
    () => ({
      focusExistingTab: (key, options) => focusConversationTabImpl(tabs, appId, key, options?.excludeTabId),
      openConversationTab: (key, title, options) => openConversationTabImpl(tabs, appId, key, title, options?.forceNew)
    }),
    [appId, tabs]
  )
}

/**
 * App-parameterized conversation navigation for callers that dispatch dynamically
 * (e.g. the global search launchpad, where the clicked app is only known at runtime).
 * Avoids one `useConversationNavigation` hook per app plus `app.id` branching at the call
 * site; multi-instance-ness comes from the registry's `instanceKey`, not an id list.
 */
export function useConversationNavigator(): ConversationNavigator {
  const tabs = useOptionalTabsContext()

  return useMemo<ConversationNavigator>(
    () => ({
      focusExistingTab: (appId, key, options) => focusConversationTabImpl(tabs, appId, key, options?.excludeTabId),
      openConversationTab: (appId, key, title) => openConversationTabImpl(tabs, appId, key, title)
    }),
    [tabs]
  )
}
