/**
 * V2 chat write-side Context.
 *
 * Owned by `V2ChatContent`, which composes `useChat` + DataApi mutations
 * into a single bag of operations and passes it down the tree. Per-message
 * consumers use `useMessage(messageId, topic)`; topic-level and dynamic-id
 * consumers use `useV2Chat()`.
 */

import type { CherryMessagePart } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { createContext, use } from 'react'

/**
 * V2 chat overrides injected via React Context. Operations delegate to
 * DataApi + useChat.
 */
/** Optional trace hints passed alongside `deleteMessage`. Used to evict
 *  the span-cache entries for a terminated assistant turn. Absent for
 *  user messages and for multi-select delete, in which case the
 *  override falls back to clearing the whole topic's active traces. */
export interface DeleteMessageTraceOptions {
  traceId?: string
  modelName?: string
}

/** Options carried alongside a regenerate request. */
export interface RegenerateOptions {
  /**
   * Override the assistant model for this turn. Used by "mention model"
   * (`@`) on an assistant message — the regenerated response joins the
   * existing sibling group as a new member using the chosen model, so the
   * group becomes a side-by-side comparison of different models.
   */
  modelId?: UniqueModelId
}

export interface V2ChatOverrides {
  regenerate: (messageId?: string, options?: RegenerateOptions) => Promise<void>
  resend: (messageId?: string) => Promise<void>
  deleteMessage: (id: string, traceOptions?: DeleteMessageTraceOptions) => Promise<void>
  deleteMessageGroup: (id: string) => Promise<void>
  pause: () => void
  clearTopicMessages: () => Promise<void>
  editMessage: (messageId: string, editedParts: CherryMessagePart[]) => Promise<void>
  /**
   * Branch a user message: create a new sibling under the same parent with the
   * edited parts, make it the active node, then regenerate the assistant
   * response anchored at the new sibling. The source message stays intact.
   */
  forkAndResend: (messageId: string, editedParts: CherryMessagePart[]) => Promise<void>
  /**
   * Switch the topic's active node.
   *
   * - Default (`descend: false`) pins the exact `messageId`. The scroll
   *   view truncates there; the user's next message becomes the new leaf
   *   and the tree forks. This is the "分支" menu action — it stays inside
   *   the current topic.
   * - `descend: true` walks from `messageId` down to any leaf before
   *   pinning, so the sibling navigator's branch-switch still shows the
   *   full follow-up chain of the target branch.
   */
  setActiveNode: (messageId: string, options?: { descend?: boolean }) => Promise<void>
  refresh: () => Promise<unknown>
}

export const V2ChatOverridesContext = createContext<V2ChatOverrides | null>(null)

export const V2ChatOverridesProvider = V2ChatOverridesContext.Provider

/**
 * Zero-arg accessor. Returns `null` outside a `V2ChatOverridesProvider` —
 * callers that must have a value should throw or early-return.
 */
export function useV2Chat(): V2ChatOverrides | null {
  return use(V2ChatOverridesContext)
}
