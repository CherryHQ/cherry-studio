import { cacheService } from '@data/CacheService'
import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart, ModelSnapshot } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { useCallback } from 'react'

import { useV2Chat } from './V2ChatContext'

/**
 * Per-message bound operations.
 *
 * Consumers that already hold a stable `message.id` for the whole render
 * (MessageMenubar, Message, etc.) should reach for this hook; topic-level
 * and dynamic-id callers (multi-select delete, group iteration) read
 * `useV2Chat()` directly.
 *
 * All write operations delegate into the V2 chat overrides context (owned
 * by `V2ChatContent`), so they pick up the optimistic SWR cache overlay
 * and refresh-failure isolation that hook wires up.
 */
export function useMessage(messageId: string) {
  const v2 = useV2Chat()

  // `V2ChatContent.handleDeleteMessage` handles span-cache cleanup
  // internally; callers that have `traceId` / `modelName` on hand (e.g.
  // `MessageMenubar` reading them off the assistant message) forward
  // them via the optional second argument.
  const remove = useCallback(
    async (traceId?: string, modelName?: string) => {
      await v2?.deleteMessage(messageId, { traceId, modelName })
    },
    [messageId, v2]
  )

  const regenerate = useCallback(async () => {
    await v2?.regenerate(messageId)
  }, [messageId, v2])

  /**
   * Regenerate this assistant turn using a different model, producing a new
   * sibling in the existing group for side-by-side comparison. Wired to the
   * `@` (mention model) button on assistant messages. Accepts an optional
   * `modelSnapshot` so the optimistic placeholder can render with the right
   * avatar + name before Main's persisted row lands.
   */
  const regenerateWithModel = useCallback(
    async (modelId: UniqueModelId, modelSnapshot?: ModelSnapshot) => {
      await v2?.regenerate(messageId, { modelId, modelSnapshot })
    },
    [messageId, v2]
  )

  const resend = useCallback(async () => {
    await v2?.resend(messageId)
  }, [messageId, v2])

  const editParts = useCallback(
    async (parts: CherryMessagePart[]) => {
      await v2?.editMessage(messageId, parts)
    },
    [messageId, v2]
  )

  const forkAndResend = useCallback(
    async (parts: CherryMessagePart[]) => {
      await v2?.forkAndResend(messageId, parts)
    },
    [messageId, v2]
  )

  /**
   * Start a new branch at this message: pin it as the topic's active node
   * (no `descend`) so the scroll view truncates here and the user's next
   * input forks the tree. Stays inside the current topic — no new topic
   * is created.
   */
  const startBranch = useCallback(async () => {
    await v2?.setActiveNode(messageId)
  }, [messageId, v2])

  return {
    remove,
    regenerate,
    regenerateWithModel,
    resend,
    editParts,
    forkAndResend,
    startBranch
  }
}

/**
 * Update per-message UI state (`foldSelected`, `multiModelMessageStyle`,
 * `useful`). Stored in Cache — transient display preferences, not persisted
 * to DB.
 *
 * Not a hook: callers frequently update UI state for multiple messages in
 * one callback (e.g. `MessageGroup` switching foldSelected across siblings),
 * which a per-id hook binding can't express. The underlying cacheService is
 * a singleton so a plain function is all that's needed.
 */
export function updateMessageUiState(
  messageId: string,
  updates: Partial<Omit<Message, 'id' | 'topicId' | 'blocks'>>
): void {
  const cacheKey = `message.ui.${messageId}` as const
  const current = cacheService.get(cacheKey) || {}
  cacheService.set(cacheKey, { ...current, ...updates })
}
