/**
 * V2 chat write-side Context.
 *
 * Owned by `V2ChatContent`, which composes `useChat` + DataApi mutations
 * into a single bag of operations and passes it down the tree. Per-message
 * consumers use `useMessage(messageId, topic)`; topic-level and dynamic-id
 * consumers use `useV2Chat()`.
 */

import type { CherryMessagePart } from '@shared/data/types/message'
import { createContext, use } from 'react'

/** AI SDK useChat status — V2 single source of truth for request state. */
export type RequestStatus = 'submitted' | 'streaming' | 'ready' | 'error'

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

export interface V2ChatOverrides {
  regenerate: (messageId?: string) => Promise<void>
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
  /** Switch the topic's active node — used to navigate between branch siblings. */
  setActiveNode: (messageId: string) => Promise<void>
  /**
   * Create a new topic by copying the ancestor chain from root to the given
   * message (excluding descendants), then switch the UI to the new topic.
   * Used by the message menu's "分支 / branch" action.
   */
  createBranchTopic: (messageId: string) => Promise<void>
  requestStatus: RequestStatus
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

/** True while a generation is in progress on the current topic. */
export function useTopicLoading(): boolean {
  const v2 = useV2Chat()
  if (!v2) return false
  return v2.requestStatus === 'submitted' || v2.requestStatus === 'streaming'
}

export function useRequestStatus(): RequestStatus | undefined {
  return useV2Chat()?.requestStatus
}
