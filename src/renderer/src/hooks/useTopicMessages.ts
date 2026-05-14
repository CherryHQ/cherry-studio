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

import { useInfiniteFlatItems, useInfiniteQuery } from '@renderer/data/hooks/useDataApi'
import { sharedMessageToUIMessage } from '@renderer/utils/messageUtils/messageProjection'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { BranchMessage, BranchMessagesResponse, Message as SharedMessage } from '@shared/data/types/message'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SWRInfiniteKeyedMutator } from 'swr/infinite'

const PAGE_SIZE = 50

/**
 * Bucket an assistant siblings-group (on-path `active` + off-path `siblings`)
 * by `modelId`. Each bucket = one model's regenerate cohort (1..N siblings
 * of the same model). Mixed cohorts — user @mentioned N models AND
 * regenerated one of them — produce N buckets, one per model.
 *
 * Fallback key when `modelId` is missing (legacy / defensive): the member's
 * own id, guaranteeing a singleton bucket that behaves like a distinct model.
 */
function bucketAssistantSiblingsByModel(members: SharedMessage[]): Map<string, SharedMessage[]> {
  const buckets = new Map<string, SharedMessage[]>()
  for (const m of members) {
    const key = m.modelId ?? m.id
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

function getBucketFirstMessage(bucket: SharedMessage[]): SharedMessage {
  let first = bucket[0]
  for (let i = 1; i < bucket.length; i++) {
    if (compareMessageOrder(bucket[i], first) < 0) first = bucket[i]
  }
  return first
}

function pickDisplayMember(bucket: SharedMessage[], activeMessageId: string): SharedMessage {
  return bucket.find((m) => m.id === activeMessageId) ?? pickLatest(bucket)
}

/**
 * Flatten a branch response into a renderer-friendly message list.
 *
 * Visibility rules:
 * - User siblings: alternate branches — only the active one is on the path;
 *   off-path branches go through the sibling navigator.
 * - Assistant siblings: bucket by `modelId`. One bubble per distinct model.
 *   - Buckets are sorted by their first-created member, so switching active
 *     branch does not reshuffle the multi-model tab order.
 *   - The active bucket displays the active member. Off-path buckets display
 *     their most-recent sibling.
 *
 * This handles the three shapes uniformly: pure regenerate (1 bucket of N →
 * 1 bubble), pure multi-model (N buckets of 1 → N bubbles), mixed (N buckets
 * where at least one has >1 → N bubbles, per-model navigator on the larger
 * buckets).
 */
function flattenBranchMessages(items: BranchMessage[]): SharedMessage[] {
  const result: SharedMessage[] = []
  for (const item of items) {
    if (!item.siblingsGroup || item.siblingsGroup.length === 0 || item.message.role === 'user') {
      result.push(item.message)
      continue
    }

    const buckets = bucketAssistantSiblingsByModel([item.message, ...item.siblingsGroup])
    const sortedBuckets = Array.from(buckets.values()).sort((a, b) =>
      compareMessageOrder(getBucketFirstMessage(a), getBucketFirstMessage(b))
    )
    for (const bucket of sortedBuckets) {
      result.push(pickDisplayMember(bucket, item.message.id))
    }
  }
  return result
}

/**
 * Build a map keyed by each sibling member's id, where the value is the
 * complete ordered group (including the member itself). Members are sorted
 * by `createdAt` so navigator position (`< 2/3 >`) is stable and matches
 * the order in which branches were created.
 *
 * - User siblings → one group per `siblings_group_id` (all members).
 * - Assistant siblings → one group per **(siblings_group_id, modelId)**.
 *   Only buckets with ≥2 members are emitted; singletons don't need a
 *   navigator. Means the mixed case surfaces a per-model navigator only
 *   on the models that were actually regenerated.
 */
function buildSiblingsMap(items: BranchMessage[]): Record<string, SharedMessage[]> {
  const map: Record<string, SharedMessage[]> = {}
  for (const item of items) {
    if (!item.siblingsGroup || item.siblingsGroup.length === 0) continue

    if (item.message.role === 'user') {
      const group = [item.message, ...item.siblingsGroup].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      for (const member of group) map[member.id] = group
      continue
    }

    const buckets = bucketAssistantSiblingsByModel([item.message, ...item.siblingsGroup])
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue
      bucket.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      for (const member of bucket) map[member.id] = bucket
    }
  }
  return map
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

export function useTopicMessages(topicId: string, options?: { enabled?: boolean }): UseTopicMessagesResult {
  const enabled = options?.enabled !== false
  const { pages, isLoading, isRefreshing, mutate, loadNext, hasNext } = useInfiniteQuery('/topics/:topicId/messages', {
    params: { topicId },
    query: { includeSiblings: true },
    limit: PAGE_SIZE,
    enabled,
    swrOptions: { dedupingInterval: 0 }
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
  const [readyTopicId, setReadyTopicId] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) {
      setReadyTopicId(topicId)
      return
    }

    setReadyTopicId((current) => (current === topicId ? current : null))
  }, [topicId, enabled])

  useEffect(() => {
    if (!enabled || isLoading || isRefreshing || !pagesBelongToTopic) return
    setReadyTopicId(topicId)
  }, [enabled, isLoading, isRefreshing, pagesBelongToTopic, topicId])

  const projectionCacheRef = useRef<WeakMap<SharedMessage, CherryUIMessage>>(new WeakMap())
  const uiMessages = useMemo<CherryUIMessage[]>(
    () => projectPagesToUI(branchItems, projectionCacheRef.current),
    [branchItems]
  )

  const siblingsMap = useMemo<Record<string, SharedMessage[]>>(() => buildSiblingsMap(branchItems), [branchItems])

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
    return projectPagesToUI(allItems, projectionCacheRef.current)
  }, [mutate, enabled])

  return {
    uiMessages,
    siblingsMap,
    isLoading: enabled && (isLoading || readyTopicId !== topicId || !pagesBelongToTopic),
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
function projectPagesToUI(
  branchItems: BranchMessage[],
  cache: WeakMap<SharedMessage, CherryUIMessage>
): CherryUIMessage[] {
  return flattenBranchMessages(branchItems).map((shared) => {
    const cached = cache.get(shared)
    if (cached) return cached
    const projected = sharedMessageToUIMessage(shared)
    cache.set(shared, projected)
    return projected
  })
}
