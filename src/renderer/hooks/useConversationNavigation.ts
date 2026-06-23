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
import { IpcChannel } from '@shared/IpcChannel'
import { useMemo } from 'react'
import { v4 as uuid } from 'uuid'

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
  /**
   * Open conversation `key` in a fresh detached window, leaving the current window's
   * tabs untouched. Unlike a tab detach this does not require `key` to be an open tab.
   */
  openConversationWindow: (key: string, title?: string) => void
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

function openConversationWindowImpl(appId: SidebarIcon, key: string, title?: string): void {
  const app = getSidebarApp(appId)
  if (!app?.instanceKey) return
  const metadata = buildSidebarAppOpenMetadata(app, key)
  // Mirrors TabsContext.detachTab's Tab_Detach payload, but with a fresh tab id and
  // without closing any current-window tab — this is "open elsewhere", not "move".
  window.electron.ipcRenderer.send(IpcChannel.Tab_Detach, {
    id: uuid(),
    url: app.instanceKey.urlForKey(key),
    title,
    type: 'route',
    ...(metadata && { metadata })
  })
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
      openConversationTab: (key, title, options) => openConversationTabImpl(tabs, appId, key, title, options?.forceNew),
      openConversationWindow: (key, title) => openConversationWindowImpl(appId, key, title)
    }),
    [appId, tabs]
  )
}
