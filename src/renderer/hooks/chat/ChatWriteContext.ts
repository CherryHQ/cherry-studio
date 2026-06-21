/**
 * Chat write-side context.
 *
 * Owned by `ChatContent`, which composes `useChat` + DataApi mutations into a
 * single bag of operations and passes it down the tree. Per-message consumers
 * use `useMessage(messageId, topic)`; topic-level and dynamic-id consumers use
 * `useChatWrite()`.
 */

import type { CherryMessagePart, ModelSnapshot } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { createContext, use } from 'react'

/** Chat write actions injected via React Context. Operations delegate to DataApi + useChat. */
/** Optional hints passed alongside `deleteMessage`. */
export interface DeleteMessageTraceOptions {
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
  /**
   * Snapshot of the overriding model (`{id, name, provider, group?}`).
   * Lets the optimistic assistant placeholder render with the right avatar
   * and model name immediately, without waiting for Main's persisted row
   * to land. Expected to agree with `modelId` — caller usually has the
   * full `Model` object on hand and can spread the relevant fields.
   */
  modelSnapshot?: ModelSnapshot
}

export interface ChatWriteActions {
  regenerate: (messageId?: string, options?: RegenerateOptions) => Promise<void>
  resend: (messageId?: string) => Promise<void>
  deleteMessage: (id: string, traceOptions?: DeleteMessageTraceOptions) => Promise<void>
  deleteMessageGroup: (id: string) => Promise<void>
  pause: () => void
  clearTopicMessages: () => Promise<void>
  editMessage: (messageId: string, editedParts: CherryMessagePart[]) => Promise<void>
  /**
   * Branch a user message: create a sibling with edited parts, make it active,
   * then regenerate the assistant response anchored at that sibling. The source
   * message stays intact, including for the first root user message.
   */
  forkAndResend: (messageId: string, editedParts: CherryMessagePart[]) => Promise<void>
  /**
   * Pin `messageId` as the topic's active node. The scroll view truncates
   * there; the user's next message becomes the new leaf and the tree forks.
   */
  setActiveNode: (messageId: string) => Promise<void>
  /**
   * Switch to the branch passing through `throughNodeId`. Resolves the
   * branch's leaf (most recent live descendant of `throughNodeId`, or
   * the node itself if it has no live children) and pins it as the
   * topic's active node — so the conversation view shows the full
   * follow-up chain rather than truncating mid-branch.
   *
   * Used by sibling navigation (per-message `< i/N >`) and multi-model
   * tab switches.
   */
  setActiveBranch: (throughNodeId: string) => Promise<void>
  refresh: () => Promise<unknown>
}

export const ChatWriteContext = createContext<ChatWriteActions | null>(null)

export const ChatWriteProvider = ChatWriteContext.Provider

/**
 * Zero-arg accessor. Returns `null` outside a `ChatWriteProvider` —
 * callers that must have a value should throw or early-return.
 */
export function useChatWrite(): ChatWriteActions | null {
  return use(ChatWriteContext)
}
