/**
 * Optimistic-cache helpers for the `/topics/:topicId/messages` infinite key.
 *
 * Every write in the chat pipeline that needs to reflect in the branch
 * message list goes through this hook — delete / edit / fork / setActiveNode
 * (DataApi mutations) and send (optimistic seed only, actual dispatch
 * happens through `useChat` / IPC).
 *
 * Two parallel stores need to stay in sync for every such write:
 *   (1) the shared SWR infinite cache for `/topics/:id/messages` — read by
 *       every `useTopicMessagesV2` subscriber (including other detached
 *       windows),
 *   (2) `useChat.state.messages` — owned by the caller's local instance.
 *
 * This hook owns (1) via the `mutate` passed in from `useTopicMessagesV2`
 * (which targets the same infinite cache key). Syncing (2) stays with the
 * caller since it holds `setMessages` from `useChatWithHistory`.
 */
import { useMutation } from '@data/hooks/useDataApi'
import type { FileMetadata } from '@renderer/types'
import type {
  BranchMessage,
  BranchMessagesResponse,
  CherryMessagePart,
  Message as SharedMessage
} from '@shared/data/types/message'
import { useCallback } from 'react'
import type { SWRInfiniteKeyedMutator } from 'swr/infinite'

/** Drop messages matching `removedIds` from items and sibling groups. */
function branchWithoutIds(items: BranchMessage[], removedIds: Set<string>): BranchMessage[] {
  return items
    .filter((item) => !removedIds.has(item.message.id))
    .map((item) =>
      item.siblingsGroup ? { ...item, siblingsGroup: item.siblingsGroup.filter((s) => !removedIds.has(s.id)) } : item
    )
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
}): SharedMessage {
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

export interface UseTopicMessagesCacheParams {
  topicId: string
  mutate: SWRInfiniteKeyedMutator<BranchMessagesResponse[]>
}

export function useTopicMessagesCache({ topicId, mutate }: UseTopicMessagesCacheParams) {
  const messagesCachePath = `/topics/${topicId}/messages` as const

  /**
   * Apply a transform to every page's `items` — suits delete / edit / patch
   * operations that don't care which page a target message lives on. The
   * transform runs once per page with that page's items and returns the new
   * item list for that page.
   */
  const seedOptimisticBranch = useCallback(
    async (transform: (items: BranchMessage[]) => BranchMessage[]) => {
      await mutate(
        (pages) => {
          if (!pages) return pages
          return pages.map((page) => ({ ...page, items: transform(page.items) }))
        },
        { revalidate: false }
      )
    },
    [mutate]
  )

  /**
   * Seed a synthesized user message as the new activeNode so the bubble
   * renders immediately after the user clicks send. Appends to the end of
   * page 0's items (page 0 = newest chunk; within-page oldest→newest order
   * means "end of page 0" is "newest overall"). The real row (allocated by
   * Main's id reservation) overwrites this entry on the next revalidation.
   */
  const seedOptimisticUser = useCallback(
    async (params: { text: string; parentId: string | null; files?: FileMetadata[] }): Promise<string | undefined> => {
      let tempId: string | undefined
      await mutate(
        (pages) => {
          if (!pages?.length) return pages
          const message = synthesizeOptimisticUserMessage({ ...params, topicId })
          tempId = message.id
          const [firstPage, ...rest] = pages
          return [
            {
              ...firstPage,
              items: [...firstPage.items, { message }],
              activeNodeId: message.id
            },
            ...rest
          ]
        },
        { revalidate: false }
      )
      return tempId
    },
    [mutate, topicId]
  )

  /** Full rollback: force a revalidation against the server. */
  const rollbackBranch = useCallback(async () => {
    await mutate()
  }, [mutate])

  /** Replace the branch cache with a single empty page. */
  const clearBranchCache = useCallback(async () => {
    await mutate([{ items: [], nextCursor: undefined, activeNodeId: null }], { revalidate: false })
  }, [mutate])

  // `useInvalidateCache`'s `invalidatePathPatterns` walks both scalar and
  // `$inf$`-prefixed cache keys (see `findMatchingInfiniteKeys`), so a
  // path-based refresh option covers the infinite cache entry too.
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
