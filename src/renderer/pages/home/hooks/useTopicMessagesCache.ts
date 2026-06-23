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
 *       every `useTopicMessages` subscriber (including other detached
 *       windows),
 *   (2) `useChat.state.messages` — owned by the caller's local instance.
 *
 * This hook owns (1) via the `mutate` passed in from `useTopicMessages`
 * (which targets the same infinite cache key). Syncing (2) stays with the
 * caller since it holds `setMessages` from `useChatWithHistory`.
 */
import { useMutation } from '@data/hooks/useDataApi'
import type {
  BranchMessage,
  BranchMessagesResponse,
  CherryMessagePart,
  CherryUIMessage,
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

function reservedUIMessageToBranchMessage(topicId: string, message: CherryUIMessage): BranchMessage {
  const metadata = message.metadata ?? {}
  const createdAt = metadata.createdAt ?? new Date().toISOString()
  return {
    message: {
      id: message.id,
      topicId,
      parentId: metadata.parentId ?? null,
      role: message.role,
      data: { parts: (message.parts ?? []) as CherryMessagePart[] },
      searchableText: '',
      status:
        metadata.status ?? (message.role === 'assistant' && (message.parts?.length ?? 0) === 0 ? 'pending' : 'success'),
      siblingsGroupId: metadata.siblingsGroupId ?? 0,
      modelId: metadata.modelId ?? null,
      modelSnapshot: metadata.modelSnapshot ?? null,
      stats: metadata.stats ?? null,
      createdAt,
      updatedAt: createdAt
    }
  }
}

export interface UseTopicMessagesCacheParams {
  topicId: string
  mutate: SWRInfiniteKeyedMutator<BranchMessagesResponse[]>
}

export function useTopicMessagesCache({ topicId, mutate }: UseTopicMessagesCacheParams) {
  const messagesCachePath = `/topics/${topicId}/messages` as const
  const treeCachePath = `/topics/${topicId}/tree` as const
  const branchCachePaths = [messagesCachePath, treeCachePath]

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

  const seedReservedMessages = useCallback(
    async (messages: CherryUIMessage[]) => {
      const reservedItems = messages.map((message) => reservedUIMessageToBranchMessage(topicId, message))
      if (reservedItems.length === 0) return

      await mutate(
        (pages) => {
          const currentPages = pages?.length
            ? pages
            : [{ items: [], nextCursor: undefined, activeNodeId: null, assistantId: null, rootId: null }]
          const existingIds = new Set(
            currentPages.flatMap((page) =>
              page.items.flatMap((item) => [
                item.message.id,
                ...(item.siblingsGroup?.map((sibling) => sibling.id) ?? [])
              ])
            )
          )
          const newItems = reservedItems.filter((item) => !existingIds.has(item.message.id))
          if (newItems.length === 0) return pages

          const nextPages = currentPages.slice()
          const firstPage = nextPages[0]
          nextPages[0] = {
            ...firstPage,
            items: [...firstPage.items, ...newItems],
            activeNodeId: newItems.at(-1)?.message.id ?? firstPage.activeNodeId
          }
          return nextPages
        },
        { revalidate: false }
      )
    },
    [mutate, topicId]
  )

  /** Replace the branch cache with a single empty page. */
  const clearBranchCache = useCallback(async () => {
    await mutate([{ items: [], nextCursor: undefined, activeNodeId: null, assistantId: null, rootId: null }], {
      revalidate: false
    })
  }, [mutate])

  // `useInvalidateCache`'s `invalidatePathPatterns` walks both scalar and
  // `$inf$`-prefixed cache keys (see `findMatchingInfiniteKeys`), so a
  // path-based refresh option covers the infinite cache entry too.
  const { trigger: deleteMessageTrigger } = useMutation('DELETE', '/messages/:id', {
    refresh: branchCachePaths
  })
  const { trigger: patchMessageTrigger } = useMutation('PATCH', '/messages/:id', {
    refresh: branchCachePaths
  })
  const { trigger: createSiblingTrigger } = useMutation('POST', '/messages/:id/siblings', {
    refresh: branchCachePaths
  })
  const { trigger: setActiveNodeTrigger } = useMutation('PUT', '/topics/:id/active-node', {
    refresh: branchCachePaths
  })
  const { trigger: clearTopicMessagesTrigger } = useMutation('DELETE', '/topics/:topicId/messages', {
    refresh: [messagesCachePath]
  })

  return {
    branchWithoutIds,
    seedOptimisticBranch,
    seedReservedMessages,
    patchMessageInBranch,
    rollbackBranch,
    clearBranchCache,
    deleteMessageTrigger,
    patchMessageTrigger,
    createSiblingTrigger,
    setActiveNodeTrigger,
    clearTopicMessagesTrigger
  }
}
