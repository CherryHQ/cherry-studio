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
import type { BranchMessage, BranchMessagesResponse, Message as SharedMessage } from '@shared/data/types/message'
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

  const patchMessageInBranch = useCallback(
    async (messageId: string, patch: Partial<SharedMessage>) => {
      await mutate(
        (pages) => {
          if (!pages) return pages
          let mutated = false
          const next = pages.map((page) => {
            const idx = page.items.findIndex((item) => item.message.id === messageId)
            if (idx === -1) return page
            mutated = true
            const items = page.items.slice()
            items[idx] = { ...items[idx], message: { ...items[idx].message, ...patch } }
            return { ...page, items }
          })
          return mutated ? next : pages
        },
        { revalidate: false }
      )
    },
    [mutate]
  )

  /** Full rollback: force a revalidation against the server. */
  const rollbackBranch = useCallback(async () => {
    await mutate()
  }, [mutate])

  /** Replace the branch cache with a single empty page. */
  const clearBranchCache = useCallback(async () => {
    await mutate([{ items: [], nextCursor: undefined, activeNodeId: null, assistantId: null }], { revalidate: false })
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
    patchMessageInBranch,
    rollbackBranch,
    clearBranchCache,
    deleteMessageTrigger,
    patchMessageTrigger,
    createSiblingTrigger,
    setActiveNodeTrigger
  }
}
