import { type TabsContextValue, useOptionalTabsContext } from '@renderer/hooks/tab'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { emitResourceListReveal, type ResourceListRevealSource } from '@renderer/services/resourceListRevealEvents'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import { buildSidebarAppOpenMetadata, getSidebarApp } from '@renderer/utils/sidebar'
import { IpcChannel } from '@shared/IpcChannel'
import { useMemo } from 'react'
import { v4 as uuid } from 'uuid'

export interface ConversationNavigation {
  /**
   * Open a new base-route tab with instance metadata. Detached windows return
   * `undefined` instead of creating a hidden internal tab.
   */
  openConversationTab: (key: string, title?: string, options?: { forceNew?: boolean }) => string | undefined
  /**
   * Open conversation `key` in the current tabs context when available; otherwise
   * open it in a detached window. Detached host windows always open elsewhere.
   */
  openConversation: (key: string, title?: string) => string | undefined
  /**
   * Open conversation `key` in a fresh detached window, leaving the current window's
   * tabs untouched. Unlike a tab detach this does not require `key` to be an open tab.
   */
  openConversationWindow: (key: string, title?: string) => void
}

// Only conversation apps that own a resource sidebar emit a reveal on open.
function resolveRevealSource(appId: SidebarAppId): ResourceListRevealSource | null {
  return appId === 'assistants' || appId === 'agents' ? appId : null
}

function openConversationTabImpl(
  tabs: TabsContextValue | null,
  appId: SidebarAppId,
  key: string,
  title?: string
): string | undefined {
  const app = getSidebarApp(appId)
  if (!tabs || !app?.instanceKey) return
  const metadata = buildSidebarAppOpenMetadata(app, key)
  const openedId = tabs.openTab(app.routePrefix, { forceNew: true, title, ...(metadata && { metadata }) })
  const source = resolveRevealSource(appId)
  if (openedId && source) emitResourceListReveal({ source, tabId: openedId })
  return openedId
}

function openConversationWindowImpl(appId: SidebarAppId, key: string, title?: string): void {
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
export function useConversationNavigation(appId: SidebarAppId): ConversationNavigation {
  const tabs = useOptionalTabsContext()
  const isDetachedWindowFrame = useWindowFrame().mode === 'window'

  return useMemo<ConversationNavigation>(
    () => ({
      openConversationTab: (key, title) =>
        isDetachedWindowFrame ? undefined : openConversationTabImpl(tabs, appId, key, title),
      openConversation: (key, title) => {
        if (tabs && !isDetachedWindowFrame) return openConversationTabImpl(tabs, appId, key, title)
        openConversationWindowImpl(appId, key, title)
        return undefined
      },
      openConversationWindow: (key, title) => openConversationWindowImpl(appId, key, title)
    }),
    [appId, isDetachedWindowFrame, tabs]
  )
}
