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
import { areDifferentModelIdentities } from '@shared/data/types/model'
import { useCallback } from 'react'
import type { SWRInfiniteKeyedMutator } from 'swr/infinite'

/** Drop messages matching `removedIds` from items and sibling groups. */
function branchWithoutIds(
  items: BranchMessage[],
  removedIds: Set<string>,
  activeNodeId: string | null
): BranchMessage[] {
  return items.flatMap((item) => {
    const siblingsGroup = item.siblingsGroup?.filter((sibling) => !removedIds.has(sibling.id)) ?? []
    if (!removedIds.has(item.message.id)) {
      return [{ ...item, ...(item.siblingsGroup ? { siblingsGroup } : {}) }]
    }

    const differentModelReplies = siblingsGroup.filter((sibling) =>
      areDifferentModelIdentities(
        { modelId: item.message.modelId, modelSnapshot: item.message.messageSnapshot?.model },
        { modelId: sibling.modelId, modelSnapshot: sibling.messageSnapshot?.model }
      )
    )

    if (
      item.message.id !== activeNodeId ||
      item.message.role !== 'assistant' ||
      item.message.siblingsGroupId === 0 ||
      differentModelReplies.length === 0
    ) {
      return []
    }

    const message = differentModelReplies.reduce((newest, sibling) =>
      sibling.createdAt > newest.createdAt || (sibling.createdAt === newest.createdAt && sibling.id > newest.id)
        ? sibling
        : newest
    )
    const remainingSiblings = siblingsGroup.filter((sibling) => sibling.id !== message.id)
    return [{ message, ...(remainingSiblings.length > 0 ? { siblingsGroup: remainingSiblings } : {}) }]
  })
}

/** When a transform promotes a sibling into the active slot, follow activeNodeId. */
function activeNodeIdAfterOptimisticTransform(
  previousItems: BranchMessage[],
  nextItems: BranchMessage[],
  activeNodeId: string | null,
  rootId: string | null
): string | null {
  if (!activeNodeId) return activeNodeId
  if (nextItems.some((item) => item.message.id === activeNodeId)) return activeNodeId

  const previousActive = previousItems.find((item) => item.message.id === activeNodeId)
  if (!previousActive) return activeNodeId
  const fallbackId = previousActive.message.parentId === rootId ? null : previousActive.message.parentId
  if (!previousActive.siblingsGroup?.length) return fallbackId

  const previousSiblingIds = new Set(previousActive.siblingsGroup.map((sibling) => sibling.id))
  const promoted = nextItems.find((item) => previousSiblingIds.has(item.message.id))
  return promoted?.message.id ?? fallbackId
}

function reparentAfterOptimisticTransform(
  previousPages: BranchMessagesResponse[],
  nextPages: BranchMessagesResponse[]
): BranchMessagesResponse[] {
  const messagesFromPages = (pages: BranchMessagesResponse[]) =>
    pages.flatMap((page) => page.items.flatMap((item) => [item.message, ...(item.siblingsGroup ?? [])]))
  const previousMessages = messagesFromPages(previousPages)
  const retainedIds = new Set(messagesFromPages(nextPages).map((message) => message.id))
  const removedParents = new Map(
    previousMessages.filter((message) => !retainedIds.has(message.id)).map((message) => [message.id, message.parentId])
  )
  if (removedParents.size === 0) return nextPages

  let nextGroupId = Math.max(0, ...previousMessages.map((message) => message.siblingsGroupId)) + 1
  const movedGroups = new Map<string | null, Map<number, number>>()
  const reparent = (message: SharedMessage): SharedMessage => {
    let parentId = message.parentId
    while (parentId && removedParents.has(parentId)) {
      parentId = removedParents.get(parentId) ?? null
    }
    if (parentId === message.parentId) return message
    if (message.siblingsGroupId === 0) return { ...message, parentId }

    let sourceGroups = movedGroups.get(message.parentId)
    if (!sourceGroups) {
      sourceGroups = new Map()
      movedGroups.set(message.parentId, sourceGroups)
    }
    if (!sourceGroups.has(message.siblingsGroupId)) sourceGroups.set(message.siblingsGroupId, nextGroupId++)
    return { ...message, parentId, siblingsGroupId: sourceGroups.get(message.siblingsGroupId)! }
  }

  return nextPages.map((page) => ({
    ...page,
    items: page.items.map((item) => ({
      ...item,
      message: reparent(item.message),
      ...(item.siblingsGroup ? { siblingsGroup: item.siblingsGroup.map(reparent) } : {})
    }))
  }))
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
      data: {
        parts: (message.parts ?? []) as CherryMessagePart[]
      },
      searchableText: '',
      status:
        metadata.status ?? (message.role === 'assistant' && (message.parts?.length ?? 0) === 0 ? 'pending' : 'success'),
      siblingsGroupId: metadata.siblingsGroupId ?? 0,
      modelId: metadata.modelId ?? null,
      messageSnapshot: metadata.messageSnapshot ?? null,
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

export function getTopicBranchCachePaths(topicId: string) {
  const messagesCachePath = `/topics/${topicId}/messages` as const
  const treeCachePath = `/topics/${topicId}/tree` as const
  return [messagesCachePath, treeCachePath]
}

export function useTopicMessagesCache({ topicId, mutate }: UseTopicMessagesCacheParams) {
  const [messagesCachePath, treeCachePath] = getTopicBranchCachePaths(topicId)
  const branchCachePaths = [messagesCachePath, treeCachePath]

  /**
   * Apply a transform to every page's `items` — suits delete / edit / patch
   * operations that don't care which page a target message lives on. The
   * transform runs once per page with that page's items and returns the new
   * item list for that page.
   */
  const seedOptimisticBranch = useCallback(
    async (transform: (items: BranchMessage[], activeNodeId: string | null) => BranchMessage[]) => {
      await mutate(
        (pages) => {
          if (!pages) return pages
          const nextPages = pages.map((page) => {
            const items = transform(page.items, page.activeNodeId)
            return {
              ...page,
              items,
              activeNodeId: activeNodeIdAfterOptimisticTransform(page.items, items, page.activeNodeId, page.rootId)
            }
          })
          return reparentAfterOptimisticTransform(pages, nextPages)
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
    async (messages: CherryUIMessage[], options: { preserveActiveNode?: boolean } = {}) => {
      const reservedItems = messages.map((message) => reservedUIMessageToBranchMessage(topicId, message))
      if (reservedItems.length === 0) return

      await mutate(
        (pages) => {
          const currentPages = pages?.length
            ? pages
            : [{ items: [], nextCursor: undefined, activeNodeId: null, assistantId: null, rootId: null }]
          const reservedById = new Map(reservedItems.map((item) => [item.message.id, item.message]))
          const consumedIds = new Set<string>()
          let replaced = false
          const nextPages = currentPages.map((page) => ({
            ...page,
            items: page.items.map((item) => {
              const replacement = reservedById.get(item.message.id)
              let siblingsChanged = false
              const siblingsGroup = item.siblingsGroup?.map((sibling) => {
                const siblingReplacement = reservedById.get(sibling.id)
                if (!siblingReplacement) return sibling
                consumedIds.add(sibling.id)
                replaced = true
                siblingsChanged = true
                return siblingReplacement
              })
              if (replacement) {
                consumedIds.add(item.message.id)
                replaced = true
              }
              if (!replacement && !siblingsChanged) return item
              return {
                ...item,
                message: replacement ?? item.message,
                ...(siblingsGroup ? { siblingsGroup } : {})
              }
            })
          }))
          const newItems = reservedItems.filter((item) => !consumedIds.has(item.message.id))
          if (!replaced && newItems.length === 0) return pages

          const firstPage = nextPages[0]
          nextPages[0] = {
            ...firstPage,
            items: [...firstPage.items, ...newItems],
            // In-place retry and live-group append reservations must never move the active branch.
            activeNodeId:
              newItems.length > 0 && !options.preserveActiveNode
                ? (newItems.at(-1)?.message.id ?? firstPage.activeNodeId)
                : firstPage.activeNodeId
          }
          return nextPages
        },
        { revalidate: false }
      )
    },
    [mutate, topicId]
  )

  // `useInvalidateCache`'s `invalidatePathPatterns` walks both scalar and
  // `$inf$`-prefixed cache keys (see `findMatchingInfiniteKeys`), so a
  // path-based refresh option covers the infinite cache entry too.
  const { trigger: deleteMessageTrigger } = useMutation('DELETE', '/messages/:id', {
    refresh: branchCachePaths
  })
  const { trigger: deleteMessageGroupTrigger } = useMutation('DELETE', '/messages/:id/reply-group', {
    refresh: branchCachePaths
  })
  const { trigger: patchMessageTrigger } = useMutation('PATCH', '/messages/:id', {
    refresh: branchCachePaths
  })
  const { trigger: createSiblingTrigger } = useMutation('POST', '/messages/:id/siblings', {
    refresh: branchCachePaths
  })
  const { trigger: createMessageTrigger } = useMutation('POST', '/topics/:topicId/messages', {
    refresh: branchCachePaths
  })
  const { trigger: setActiveNodeTrigger } = useMutation('PUT', '/topics/:id/active-node', {
    refresh: branchCachePaths
  })
  return {
    branchWithoutIds,
    seedOptimisticBranch,
    seedReservedMessages,
    patchMessageInBranch,
    rollbackBranch,
    deleteMessageTrigger,
    deleteMessageGroupTrigger,
    patchMessageTrigger,
    createSiblingTrigger,
    createMessageTrigger,
    setActiveNodeTrigger
  }
}
