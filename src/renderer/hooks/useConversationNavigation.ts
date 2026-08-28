import { type TabsContextValue, useOptionalTabsContext } from '@renderer/hooks/tab'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { ipcApi } from '@renderer/ipc'
import type { ConversationAppId } from '@renderer/types/conversation'
import { getSidebarApp } from '@renderer/utils/sidebar'
import { useMemo } from 'react'
import { v4 as uuid } from 'uuid'

export interface ConversationNavigation {
  /**
   * Open a new tab on the conversation's own URL. Detached windows return
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

function openConversationTabImpl(
  tabs: TabsContextValue | null,
  appId: ConversationAppId,
  key: string,
  title?: string
): string | undefined {
  const app = getSidebarApp(appId)
  if (!tabs || !app?.conversationRoute) return
  return tabs.openTab(app.conversationRoute.urlForKey(key), { forceNew: true, title })
}

function openConversationWindowImpl(appId: ConversationAppId, key: string, title?: string): void {
  const app = getSidebarApp(appId)
  if (!app?.conversationRoute) return
  // Mirrors TabsContext.detachTab's tab.detach payload, but with a fresh tab id and
  // without closing any current-window tab — this is "open elsewhere", not "move".
  void ipcApi.request('tab.detach', {
    id: uuid(),
    url: app.conversationRoute.urlForKey(key),
    title,
    type: 'route'
  })
}

/**
 * Single boundary for "navigate to a conversation tab" intents (chat topic / agent
 * session), bound to one app. Built on the SIDEBAR_APPS registry's key↔URL mapping
 * (`conversationRoute`), so pages and lists stop touching the tabs context, `openTab`, or URL
 * helpers directly.
 *
 * Degrades to no-ops when there is no TabsProvider (tests, detached popups) or when the
 * app has no `conversationRoute`.
 */
export function useConversationNavigation(appId: ConversationAppId): ConversationNavigation {
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
