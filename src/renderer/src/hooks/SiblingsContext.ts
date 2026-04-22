/**
 * Sibling-branch context.
 *
 * Carries the per-topic `siblingsMap` (from `useTopicMessagesV2`) and the
 * current `activeNodeId` so user-message sibling navigators can render
 * `< i/N >` and switch branches without each consumer plumbing topic-level
 * state through props.
 */

import type { Message as SharedMessage } from '@shared/data/types/message'
import { createContext, use, useMemo } from 'react'

export interface SiblingsContextValue {
  /** See `UseTopicMessagesV2Result.siblingsMap`. */
  siblingsMap: Record<string, SharedMessage[]>
  /** Current topic `activeNodeId`, used to compute which sibling is in view. */
  activeNodeId: string | null
}

export const SiblingsContext = createContext<SiblingsContextValue | null>(null)
export const SiblingsProvider = SiblingsContext.Provider

/**
 * Resolve the sibling group the message belongs to, along with its index
 * within the group (0-based). The caller renders only when they are the
 * in-view branch, so the message is by construction one of the members —
 * we locate it by id.
 *
 * Returns `null` when the message has no siblings.
 */
export function useMessageSiblings(messageId: string): {
  group: SharedMessage[]
  activeIndex: number
} | null {
  const ctx = use(SiblingsContext)

  return useMemo(() => {
    if (!ctx) return null
    const group = ctx.siblingsMap[messageId]
    if (!group || group.length < 2) return null

    const activeIndex = group.findIndex((m) => m.id === messageId)
    return { group, activeIndex: activeIndex >= 0 ? activeIndex : 0 }
  }, [ctx, messageId])
}
