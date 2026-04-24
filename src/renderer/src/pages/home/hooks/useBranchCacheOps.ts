/**
 * Optimistic-cache helpers for a topic's branch messages.
 *
 * Two parallel optimistic stores need to stay in sync for every write
 * handler in `V2ChatContent`:
 *   (1) the shared SWR cache for `/topics/:id/messages` — read by every
 *       `useTopicMessagesV2` subscriber (including other detached
 *       windows).
 *   (2) `useChat.state.messages` — owned by the local instance,
 *       populated from DB via `setMessages(refreshed)` on stream-done
 *       but never auto-synced to SWR updates otherwise.
 *
 * This hook owns the (1) side (plus the DataApi mutation triggers),
 * returning a small set of functions the caller wires into its handlers.
 * The (2) side stays with the caller because the caller already holds
 * `setMessages` from `useChatWithHistory`.
 */
import { useInvalidateCache, useMutation, useReadCache, useWriteCache } from '@data/hooks/useDataApi'
import type { BranchMessagesResponse } from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'

/** Compute the optimistic branch response with the given ids removed. */
function branchWithoutIds(prev: BranchMessagesResponse, removedIds: Set<string>): BranchMessagesResponse {
  const items = prev.items
    .filter((item) => !removedIds.has(item.message.id))
    .map((item) =>
      item.siblingsGroup ? { ...item, siblingsGroup: item.siblingsGroup.filter((s) => !removedIds.has(s.id)) } : item
    )
  return { ...prev, items }
}

export function useBranchCacheOps(topicId: string) {
  const messagesCachePath = useMemo(() => `/topics/${topicId}/messages` as const, [topicId])
  const messagesCacheQuery = useMemo(() => ({ limit: 999, includeSiblings: true }), [])
  const messagesRefreshKeys = useMemo<`/topics/${string}/messages`[]>(() => [`/topics/${topicId}/messages`], [topicId])

  const readCache = useReadCache()
  const writeCache = useWriteCache()
  const invalidateCache = useInvalidateCache()

  /** Write a transformed cache value; caller handles rollback on error. */
  const seedOptimisticBranch = useCallback(
    async (transform: (prev: BranchMessagesResponse) => BranchMessagesResponse) => {
      const prev = readCache<BranchMessagesResponse>(messagesCachePath, messagesCacheQuery)
      if (!prev) return
      await writeCache(messagesCachePath, transform(prev), messagesCacheQuery)
    },
    [messagesCachePath, messagesCacheQuery, readCache, writeCache]
  )

  /** Full rollback: force a revalidation against the server. */
  const rollbackBranch = useCallback(async () => {
    await invalidateCache(messagesCachePath)
  }, [invalidateCache, messagesCachePath])

  /** Replace the branch cache with an empty snapshot (clear-topic path). */
  const clearBranchCache = useCallback(async () => {
    await writeCache(messagesCachePath, { items: [], nextCursor: undefined, activeNodeId: null }, messagesCacheQuery)
  }, [messagesCachePath, messagesCacheQuery, writeCache])

  const { trigger: deleteMessageTrigger } = useMutation('DELETE', '/messages/:id', {
    refresh: messagesRefreshKeys
  })
  const { trigger: patchMessageTrigger } = useMutation('PATCH', '/messages/:id', {
    refresh: messagesRefreshKeys
  })
  const { trigger: createSiblingTrigger } = useMutation('POST', '/messages/:id/siblings', {
    refresh: messagesRefreshKeys
  })
  const { trigger: setActiveNodeTrigger } = useMutation('PUT', '/topics/:id/active-node', {
    refresh: messagesRefreshKeys
  })

  return {
    branchWithoutIds,
    seedOptimisticBranch,
    rollbackBranch,
    clearBranchCache,
    deleteMessageTrigger,
    patchMessageTrigger,
    createSiblingTrigger,
    setActiveNodeTrigger
  }
}
