/**
 * Optimistic-cache helpers for the `/topics/:topicId/messages` SWR key.
 *
 * Every write in the chat pipeline that needs to reflect in the branch
 * message list goes through this hook — delete / edit / fork / setActiveNode
 * (DataApi mutations) and send (optimistic seed only, actual dispatch
 * happens through `useChat` / IPC).
 *
 * Two parallel stores need to stay in sync for every such write:
 *   (1) the shared SWR cache for `/topics/:id/messages` — read by every
 *       `useTopicMessagesV2` subscriber (including other detached windows),
 *   (2) `useChat.state.messages` — owned by the caller's local instance.
 *
 * This hook owns (1) plus the DataApi mutation triggers. Syncing (2) stays
 * with the caller since it holds `setMessages` from `useChatWithHistory`.
 */
import { useInvalidateCache, useMutation, useReadCache, useWriteCache } from '@data/hooks/useDataApi'
import type { FileMetadata } from '@renderer/types'
import type { BranchMessagesResponse, CherryMessagePart } from '@shared/data/types/message'
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

/**
 * Synthesize a SharedMessage for an optimistic user bubble. Only fields the
 * renderer's projection reads are filled meaningfully — the rest get safe
 * defaults that the real DB row overwrites on the next SWR revalidation
 * (triggered by Main's cache invalidate ~30–80ms after streamOpen).
 */
function synthesizeOptimisticUserMessage(params: {
  topicId: string
  parentId: string | null
  text: string
  files?: FileMetadata[]
}): BranchMessagesResponse['items'][number]['message'] {
  const parts: CherryMessagePart[] = [{ type: 'text', text: params.text }]
  if (params.files?.length) {
    for (const file of params.files) {
      parts.push({
        type: 'file',
        url: file.path,
        mediaType: file.ext ?? 'application/octet-stream',
        filename: file.origin_name ?? file.name
      } as CherryMessagePart)
    }
  }
  const now = new Date().toISOString()
  return {
    id: `optimistic-${crypto.randomUUID()}`,
    topicId: params.topicId,
    parentId: params.parentId,
    role: 'user',
    data: { parts },
    searchableText: params.text,
    status: 'success',
    siblingsGroupId: 0,
    modelId: null,
    modelSnapshot: null,
    traceId: null,
    stats: null,
    createdAt: now,
    updatedAt: now
  }
}

export function useTopicMessagesCache(topicId: string) {
  const messagesCachePath = `/topics/${topicId}/messages` as const
  const messagesCacheQuery = useMemo(() => ({ limit: 999, includeSiblings: true }), [])

  const readCache = useReadCache()
  const writeCache = useWriteCache()
  const invalidateCache = useInvalidateCache()

  /** Write a transformed branch response; caller handles rollback on error. */
  const seedOptimisticBranch = useCallback(
    async (transform: (prev: BranchMessagesResponse) => BranchMessagesResponse) => {
      const prev = readCache<BranchMessagesResponse>(messagesCachePath, messagesCacheQuery)
      if (!prev) return
      await writeCache(messagesCachePath, transform(prev), messagesCacheQuery)
    },
    [messagesCachePath, messagesCacheQuery, readCache, writeCache]
  )

  /**
   * Seed a synthesized user message as the next on-path item so the bubble
   * renders immediately after the user clicks send. The real row (allocated
   * by Main's id reservation) overwrites this entry on the next SWR
   * revalidation. Returns the temp id for logging / failure tracing.
   */
  const seedOptimisticUser = useCallback(
    async (params: { text: string; parentId: string | null; files?: FileMetadata[] }): Promise<string | undefined> => {
      const prev = readCache<BranchMessagesResponse>(messagesCachePath, messagesCacheQuery)
      if (!prev) return undefined
      const message = synthesizeOptimisticUserMessage({ ...params, topicId })
      const next: BranchMessagesResponse = {
        ...prev,
        items: [...prev.items, { message }],
        activeNodeId: message.id
      }
      await writeCache(messagesCachePath, next, messagesCacheQuery)
      return message.id
    },
    [messagesCachePath, messagesCacheQuery, readCache, writeCache, topicId]
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
    refresh: [messagesCachePath]
  })
  const { trigger: patchMessageTrigger } = useMutation('PATCH', '/messages/:id', {
    refresh: [messagesCachePath]
  })
  const { trigger: createSiblingTrigger } = useMutation('POST', '/messages/:id/siblings', {
    refresh: [messagesCachePath]
  })
  const { trigger: setActiveNodeTrigger } = useMutation('PUT', '/topics/:id/active-node', {
    refresh: [messagesCachePath]
  })

  return {
    branchWithoutIds,
    seedOptimisticBranch,
    seedOptimisticUser,
    rollbackBranch,
    clearBranchCache,
    deleteMessageTrigger,
    patchMessageTrigger,
    createSiblingTrigger,
    setActiveNodeTrigger
  }
}
