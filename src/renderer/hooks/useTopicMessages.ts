/**
 * Hook for loading topic messages from DataApi as CherryUIMessage[].
 *
 * Uses `useInfiniteQuery` + `useInfiniteFlatItems` with `reversePages: true` —
 * the branch endpoint paginates newest-page-first but keeps within-page items
 * in oldest→newest order, so reversing page order yields a monotonically
 * chronological `items` array (root → activeNode) across any number of loaded
 * pages. `activeNodeId` is read from the freshest page's top-level metadata.
 *
 * `toUIMessage` projects every persisted field onto `CherryUIMessage.metadata`
 * so downstream consumers read per-message metadata (model, parent, stats,
 * status, …) directly from the message object — no parallel metadataMap
 * lookup that can lag behind `useChat.state.messages` during streaming.
 */

import { usePreference } from '@data/hooks/usePreference'
import { useDataChange, useInfiniteFlatItems, useInfiniteQuery } from '@renderer/data/hooks/useDataApi'
import { sharedMessageToUIMessage } from '@renderer/utils/message/messageProjection'
import { resolveUniqueModelId } from '@renderer/utils/message/modelIdentity'
import type {
  BranchMessage,
  BranchMessagesResponse,
  CherryUIMessage,
  Message as SharedMessage
} from '@shared/data/types/message'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SWRInfiniteKeyedMutator } from 'swr/infinite'

// Baseline page size when the anchor rail is off — no reason to load more.
const PAGE_SIZE = 50

// Sized so one page (~75 turns) fills the anchor rail's visible capacity on a
// typical full-height window (~73 ticks at 10px pitch) — the rail then shows a
// complete strip on entry instead of visibly growing as older pages stream in.
const ANCHOR_RAIL_PAGE_SIZE = 150

interface DisplayBranchMessage {
  message: SharedMessage
  isActiveBranch: boolean
}

interface BranchProjection {
  displayMessages: DisplayBranchMessage[]
  siblingsMap: Record<string, SharedMessage[]>
}

/**
 * Bucket an assistant siblings-group (on-path `active` + off-path `siblings`)
 * by `modelId`. Each bucket = one model's regenerate cohort (1..N siblings
 * of the same model). Mixed cohorts — user @mentioned N models AND
 * regenerated one of them — produce N buckets, one per model.
 *
 * Imported messages may only carry model identity in `messageSnapshot`, so
 * resolve both sources before falling back to a singleton bucket.
 */
function bucketAssistantSiblingsByModel(members: SharedMessage[]): Map<string, SharedMessage[]> {
  const buckets = new Map<string, SharedMessage[]>()
  for (const m of members) {
    const key = resolveUniqueModelId(m.modelId, m.messageSnapshot?.model) ?? m.id
    const bucket = buckets.get(key)
    if (bucket) bucket.push(m)
    else buckets.set(key, [m])
  }
  return buckets
}

/** Pick the display member of an off-path model bucket: most recent sibling. */
function pickLatest(bucket: SharedMessage[]): SharedMessage {
  let latest = bucket[0]
  for (let i = 1; i < bucket.length; i++) {
    if (compareMessageOrder(bucket[i], latest) > 0) latest = bucket[i]
  }
  return latest
}

function compareMessageOrder(a: SharedMessage, b: SharedMessage): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

function pickDisplayMember(bucket: SharedMessage[], activeMessageId: string): SharedMessage {
  return bucket.find((m) => m.id === activeMessageId) ?? pickLatest(bucket)
}

/** Project display rows and sibling navigation from one shared group classification. */
function projectBranchMessages(items: BranchMessage[]): BranchProjection {
  const displayMessages: DisplayBranchMessage[] = []
  const siblingsMap: Record<string, SharedMessage[]> = {}
  for (const item of items) {
    if (!item.siblingsGroup || item.siblingsGroup.length === 0) {
      displayMessages.push({ message: item.message, isActiveBranch: true })
      continue
    }

    const members = [item.message, ...item.siblingsGroup]
    if (item.message.role === 'user') {
      displayMessages.push({ message: item.message, isActiveBranch: true })
      const group = members.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      for (const member of group) siblingsMap[member.id] = group
      continue
    }

    const buckets = bucketAssistantSiblingsByModel(members)
    const isMultiModelGroup = buckets.size > 1
    if (isMultiModelGroup) {
      for (const message of members.sort(compareMessageOrder)) {
        displayMessages.push({ message, isActiveBranch: message.id === item.message.id })
      }
      continue
    }

    const bucket = buckets.values().next().value!
    const message = pickDisplayMember(bucket, item.message.id)
    displayMessages.push({ message, isActiveBranch: message.id === item.message.id })
    if (bucket.length < 2) continue
    bucket.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    for (const member of bucket) siblingsMap[member.id] = bucket
  }
  return { displayMessages, siblingsMap }
}

// ── Hook ──

export interface UseTopicMessagesResult {
  uiMessages: CherryUIMessage[]
  /**
   * Map from any sibling member's id to the full ordered sibling group
   * (includes the member itself). Lets the sibling navigator render
   * `< i/N >` without reconstructing the group on the fly. Only groups
   * with ≥ 2 members are present.
   */
  siblingsMap: Record<string, SharedMessage[]>
  isLoading: boolean
  isStale: boolean
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
  /** Load the next (older) page of branch history. */
  loadOlder: () => void
  /** Whether older pages remain on the server. */
  hasOlder: boolean
  /**
   * SWR mutator for the underlying infinite cache entry. Exposed so
   * `useTopicMessagesCache` can apply optimistic writes via the updater
   * form (`mutate((pages) => next, { revalidate: false })`).
   */
  mutate: SWRInfiniteKeyedMutator<BranchMessagesResponse[]>
}

export function useTopicMessages(
  topicId: string,
  options?: { enabled?: boolean; fetchOnMount?: boolean }
): UseTopicMessagesResult {
  const enabled = options?.enabled !== false
  const fetchOnMount = options?.fetchOnMount ?? enabled
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  // `limit` is part of the SWR infinite key, so toggling the preference
  // mid-session swaps to a fresh cache entry instead of mixing page sizes.
  const pageSize = messageNavigation === 'anchor' ? ANCHOR_RAIL_PAGE_SIZE : PAGE_SIZE
  const { pages, isLoading, isRefreshing, mutate, loadNext, hasNext } = useInfiniteQuery('/topics/:topicId/messages', {
    params: { topicId },
    query: { includeSiblings: true },
    limit: pageSize,
    enabled,
    swrOptions: {
      dedupingInterval: 0,
      ...(!fetchOnMount && {
        revalidateIfStale: false,
        revalidateOnMount: false
      })
    }
  })
  // Branch endpoint paginates newest-page-first; flipping page order gives a
  // chronological root → activeNode list. `activeNodeId` lives on each page
  // response — page 0 is the freshest fetch, so its value is authoritative.
  const branchItems = useInfiniteFlatItems(pages, { reversePages: true })
  const pagesBelongToTopic = useMemo(
    () =>
      pages.every((page) =>
        page.items.every(
          (item) =>
            item.message.topicId === topicId &&
            (item.siblingsGroup ?? []).every((sibling) => sibling.topicId === topicId)
        )
      ),
    [pages, topicId]
  )
  const activeNodeId = pages[0]?.activeNodeId ?? null

  // On remount with stale SWR cache, SWR may expose cached data while it
  // revalidates. Track freshness per topic so the loading gate blocks stale
  // cached rows without issuing an extra mutate() on top of SWR's own fetch.
  const [readyTopicId, setReadyTopicId] = useState<string | null>(() => (!fetchOnMount ? topicId : null))
  useEffect(() => {
    if (!enabled || !fetchOnMount) {
      setReadyTopicId(topicId)
      return
    }

    setReadyTopicId((current) => (current === topicId ? current : null))
  }, [topicId, enabled, fetchOnMount])

  useEffect(() => {
    if (!enabled || isLoading || isRefreshing || !pagesBelongToTopic) return
    setReadyTopicId(topicId)
  }, [enabled, isLoading, isRefreshing, pagesBelongToTopic, topicId])

  const projectionCacheRef = useRef<WeakMap<SharedMessage, CherryUIMessage>>(new WeakMap())
  const branchProjection = useMemo(() => projectBranchMessages(branchItems), [branchItems])
  const uiMessages = useMemo<CherryUIMessage[]>(
    () => projectDisplayMessagesToUI(branchProjection.displayMessages, projectionCacheRef.current),
    [branchProjection.displayMessages]
  )
  const loadedMessageIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of branchItems) {
      ids.add(item.message.id)
      for (const sibling of item.siblingsGroup ?? []) ids.add(sibling.id)
    }
    return ids
  }, [branchItems])

  useDataChange(
    '/topics/:topicId/messages',
    (effects) => {
      // Membership effects carry the NEW row ids — never in loadedMessageIds yet.
      // Route scoping already limits them to this topic, so they must always refetch.
      if (
        enabled &&
        effects.some(
          (effect) =>
            !effect.entityIds ||
            effect.kind === 'membership' ||
            effect.entityIds.some((messageId) => loadedMessageIds.has(messageId))
        )
      ) {
        void mutate()
      }
    },
    { routeParams: { topicId } }
  )

  // `refresh` revalidates every loaded page and returns the flattened
  // uiMessages so `useChatWithHistory`'s on-done handler can push DB truth
  // into `useChat.state.messages`. Reuses the same projection helper as the
  // memo above so the two paths can't drift on flatten / cache semantics.
  const refresh = useCallback(async (): Promise<CherryUIMessage[]> => {
    if (!enabled) return []
    const refreshed = await mutate()
    if (!refreshed?.length) return []
    const allItems = refreshed
      .slice()
      .reverse()
      .flatMap((p) => p.items)
    return projectBranchMessagesToUI(allItems, projectionCacheRef.current)
  }, [mutate, enabled])

  const isStale = enabled && (readyTopicId !== topicId || !pagesBelongToTopic)

  return {
    uiMessages,
    siblingsMap: branchProjection.siblingsMap,
    isLoading: enabled && (isLoading || isStale),
    isStale,
    refresh,
    activeNodeId,
    loadOlder: loadNext,
    hasOlder: hasNext,
    mutate: mutate
  }
}

/**
 * Flatten paginated branch items into chronological `CherryUIMessage[]`,
 * reusing the per-row WeakMap so a stable shared message keeps its
 * projection identity across re-renders.
 */
export function projectBranchMessagesToUI(
  branchItems: BranchMessage[],
  cache: WeakMap<SharedMessage, CherryUIMessage> = new WeakMap()
): CherryUIMessage[] {
  return projectDisplayMessagesToUI(projectBranchMessages(branchItems).displayMessages, cache)
}

function projectDisplayMessagesToUI(
  displayMessages: DisplayBranchMessage[],
  cache: WeakMap<SharedMessage, CherryUIMessage>
): CherryUIMessage[] {
  return displayMessages.map(({ message, isActiveBranch }) => {
    const cached = cache.get(message)
    if (cached && cached.metadata?.isActiveBranch === isActiveBranch) return cached
    const projected = sharedMessageToUIMessage(message)
    projected.metadata = {
      ...projected.metadata,
      isActiveBranch
    }
    cache.set(message, projected)
    return projected
  })
}
