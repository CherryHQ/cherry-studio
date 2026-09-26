import { createContext, use } from 'react'

import type { ConversationAppId } from '@renderer/types/conversation'

export type ConversationTabVisuals = { title: string }

/**
 * Retitle the tabs of one conversation. Both actions are idempotent — a tab already showing
 * the title is left alone — and neither touches the icon: a rename never moves the
 * conversation's assistant/agent emoji. Tabs whose page is hidden or dormant cannot derive a
 * renamed title themselves, so the name has to be pushed to them.
 */
export interface ConversationTabsSync {
  /** This window's tabs only. For a title received from main, which already reached every window. */
  apply(appId: ConversationAppId, key: string, visuals: ConversationTabVisuals): void
  /** Every window: applies here, then relays to the others. For a rename this window wrote. */
  sync(appId: ConversationAppId, key: string, visuals: ConversationTabVisuals): void
}

const noConversationTabsSync: ConversationTabsSync = { apply: () => {}, sync: () => {} }

export const ConversationTabsSyncContext = createContext<ConversationTabsSync | null>(null)

export function useConversationTabsSync(): ConversationTabsSync {
  return use(ConversationTabsSyncContext) ?? noConversationTabsSync
}
