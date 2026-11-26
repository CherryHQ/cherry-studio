/**
 * Hook for loading topic messages from DataApi as CherryUIMessage[].
 *
 * Uses `useConversationHistoryQuery` —
 * the branch endpoint paginates newest-page-first but keeps within-page items
 * in oldest→newest order, so reversing page order yields a monotonically
 * chronological `items` array (root → activeNode) across any number of loaded
 * pages. `activeNodeId` is read from the freshest page's top-level metadata.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SWRInfiniteKeyedMutator } from 'swr/infinite'

import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { useDataChange, useWriteInfinitePage } from '@renderer/data/hooks/useDataApi'
import type { MessageListSelectAllPagination } from '@renderer/types/message'
import { sharedMessageToUIMessage } from '@renderer/utils/message/messageProjection'
import { resolveUniqueModelId } from '@renderer/utils/message/modelIdentity'
import type {
  BranchMessage,
  BranchMessagesResponse,
  CherryUIMessage,
  Message as SharedMessage
} from '@shared/data/types/message'

import { useHistoryPageProjection } from './historyPageLayout'
import { useConversationHistoryQuery } from './useConversationHistoryQuery'
import { type HistorySlot, type PageRows, type ReplyHistory, useHistoryRowUpdates } from './useHistoryRowUpdates'

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
    bucket.sort(compareMessageOrder)
    for (const member of bucket) siblingsMap[member.id] = bucket
  }
  return { displayMessages, siblingsMap }
}

function branchBelongsToTopic(item: BranchMessage, topicId: string): boolean {
  return item.message.topicId === topicId && (item.siblingsGroup ?? []).every((sibling) => sibling.topicId === topicId)
}

const branchRows: PageRows<BranchMessage, SharedMessage> = {
  get(items, { item, sibling }) {
    return sibling === undefined ? items[item]?.message : items[item]?.siblingsGroup?.[sibling]
  },
  replace(items, { item, sibling }, row) {
    const entry = items[item]
    return items.with(
      item,
      sibling === undefined
        ? { ...entry, message: row }
        : { ...entry, siblingsGroup: entry.siblingsGroup!.with(sibling, row) }
    )
  }
}

// ── Hook ──

export interface UseTopicMessagesResult {
  displayIndex(id: string): number | undefined
  uiMessages: CherryUIMessage[]
  replyHistory: ReplyHistory
  /**
   * Map from any sibling member's id to the full ordered sibling group
   * (includes the member itself). Lets the sibling navigator render
   * `< i/N >` without reconstructing the group on the fly. Only groups
   * with ≥ 2 members are present.
   */
  siblingsMap: Record<string, SharedMessage[]>
  /** Loaded tail of the active path (root → activeNode), without siblings: the rows a request is built from. */
  pathMessages: SharedMessage[]
  isLoading: boolean
  isStale: boolean
  refresh: () => Promise<void>
  activeNodeId: string | null
  /** Load the next (older) page of branch history. */
  loadOlder: () => void
  /** Whether older pages remain on the server. */
  hasOlder: boolean
  /**
   * Load-all handle for the multi-select "select all" action: pages to the
   * end (so parts are resident for export) with start/stop control.
   */
  selectAllPagination: MessageListSelectAllPagination
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
  // Load-all mode (multi-select "select all"): auto-paginate to the oldest
  // page — same pattern as `useTopics({ loadAll: true })`. `loadNext` is
  // fire-and-forget (its promise is dropped inside useDataApi), so a failed
  // page fetch is detected via the query `error` and abandons load-all
  // instead of retrying on every render; the user can re-trigger select-all.
  const [loadAllRequested, setLoadAllRequested] = useState(false)
  const stopLoadAll = useCallback(() => setLoadAllRequested(false), [])
  useEffect(() => {
    stopLoadAll()
  }, [stopLoadAll, topicId])
  const {
    pages,
    isLoading,
    isRefreshing,
    error,
    mutate,
    loadNext,
    hasNext,
    refresh: refreshPages
  } = useConversationHistoryQuery('/topics/:topicId/messages', {
    params: { topicId },
    query: { includeSiblings: true },
    limit: pageSize,
    enabled,
    swrOptions: {
      dedupingInterval: 0,
      // Paging to the end must not revalidate the first page on every step
      // (same as `useTopics({ loadAll: true })`); restored once finished.
      revalidateFirstPage: !loadAllRequested,
      ...(!fetchOnMount && {
        revalidateIfStale: false,
        revalidateOnMount: false
      })
    }
  })
  // Branch endpoint paginates newest-page-first; flipping page order gives a
  // chronological root → activeNode list. `activeNodeId` lives on each page
  // response — page 0 is the freshest fetch, so its value is authoritative.
  const projectionCacheRef = useRef<WeakMap<SharedMessage, CherryUIMessage>>(new WeakMap())
  const activeNodeId = pages[0]?.activeNodeId ?? null
  const build = useCallback(
    (pages: { items: BranchMessage[] }[]) => {
      const items = pages.toReversed().flatMap((page) => page.items)
      const { displayMessages, siblingsMap } = projectBranchMessages(items)
      const uiMessages = projectDisplayMessagesToUI(displayMessages, projectionCacheRef.current)
      const positions = new Map<string, HistorySlot & { displayIndex?: number; pathIndex?: number }>()
      pages.forEach(({ items }, page) => {
        items.forEach((entry, item) => {
          positions.set(entry.message.id, { page, item })
          entry.siblingsGroup?.forEach((row, sibling) => positions.set(row.id, { page, item, sibling }))
        })
      })
      uiMessages.forEach((row, index) => {
        positions.get(row.id)!.displayIndex = index
      })
      const pagesBelongToTopic = items.every((item) => branchBelongsToTopic(item, topicId))
      const excluded = new Set<string>()
      for (const [id, slot] of positions) if (slot.displayIndex === undefined) excluded.add(id)
      const pathMessages: SharedMessage[] = []
      let id = activeNodeId
      while (id) {
        const slot = positions.get(id)
        if (!slot) break
        const entry = pages[slot.page].items[slot.item]
        const row = slot.sibling === undefined ? entry.message : entry.siblingsGroup?.[slot.sibling]
        if (!row) break
        pathMessages.push(row)
        id = row.parentId
      }
      pathMessages.reverse().forEach((row, i) => {
        positions.get(row.id)!.pathIndex = i
      })
      return { positions, uiMessages, siblingsMap, pagesBelongToTopic, excluded, pathMessages }
    },
    [activeNodeId, topicId]
  )
  const replace = useCallback(
    (view: ReturnType<typeof build>, changes: BranchMessage[]) => {
      if (!view.pagesBelongToTopic) return
      const uiMessages = view.uiMessages.slice()
      let siblingsMap = view.siblingsMap
      let pathMessages = view.pathMessages
      for (const entry of changes) {
        if (!branchBelongsToTopic(entry, topicId)) return
        const group = projectBranchMessages([entry])
        const messages = projectDisplayMessagesToUI(group.displayMessages, projectionCacheRef.current)
        const start = view.positions.get(messages[0].id)?.displayIndex
        if (start === undefined) return
        const members = [entry.message, ...(entry.siblingsGroup ?? [])]
        if (members.filter((row) => view.positions.get(row.id)?.displayIndex !== undefined).length !== messages.length)
          return
        for (const [i, row] of messages.entries()) {
          if (view.positions.get(row.id)?.displayIndex !== start + i) return
          uiMessages[start + i] = row
        }
        for (const member of members) {
          const index = view.positions.get(member.id)?.pathIndex
          if (index === undefined || pathMessages[index] === member) continue
          if (pathMessages[index].parentId !== member.parentId) return
          if (pathMessages === view.pathMessages) pathMessages = pathMessages.slice()
          pathMessages[index] = member
        }
        if (entry.siblingsGroup?.length) {
          if (siblingsMap === view.siblingsMap) siblingsMap = { ...siblingsMap }
          for (const member of members) delete siblingsMap[member.id]
          Object.assign(siblingsMap, group.siblingsMap)
        }
      }
      return { ...view, uiMessages, siblingsMap, pathMessages }
    },
    [topicId]
  )
  const { positions, uiMessages, siblingsMap, pagesBelongToTopic, excluded, pathMessages } = useHistoryPageProjection(
    pages,
    build,
    replace
  )

  // Errors that predate the load-all are baseline; only a NEW error while paging
  // abandons it. A retained error would otherwise deadlock a retried select-all
  // behind the !error gate, so starting also revalidates it away.
  const loadAllBaselineErrorRef = useRef<Error | undefined>(undefined)
  const startLoadAll = useCallback(() => {
    loadAllBaselineErrorRef.current = error
    setLoadAllRequested(true)
    if (error) void mutate()
  }, [error, mutate])
  useEffect(() => {
    if (enabled && loadAllRequested && hasNext && !isLoading && !isRefreshing && !error) {
      loadNext()
    }
  }, [enabled, error, hasNext, isLoading, isRefreshing, loadAllRequested, loadNext])
  // A failed page fetch (new error vs the start baseline) abandons the load-all.
  useEffect(() => {
    if (error && loadAllRequested && error !== loadAllBaselineErrorRef.current) stopLoadAll()
  }, [error, loadAllRequested, stopLoadAll])
  // Fully loaded — reset so first-page revalidation resumes after select-all.
  useEffect(() => {
    if (loadAllRequested && !hasNext) stopLoadAll()
  }, [hasNext, loadAllRequested, stopLoadAll])

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

  const writePage = useWriteInfinitePage('/topics/:topicId/messages', {
    params: { topicId },
    query: { includeSiblings: true },
    limit: pageSize
  })
  const readRow = useCallback((id: string) => dataApiService.get(`/messages/${id}`), [])
  const { replyHistory, onChange } = useHistoryRowUpdates(
    pages,
    positions,
    branchRows,
    readRow,
    writePage,
    topicId,
    refreshPages,
    excluded
  )
  useDataChange(
    '/topics/:topicId/messages',
    (effects) => {
      if (enabled) onChange(effects)
    },
    { routeParams: { topicId } }
  )

  const refresh = useCallback(async () => {
    if (enabled) await refreshPages({ throwOnError: true })
  }, [refreshPages, enabled])

  const isStale = enabled && (readyTopicId !== topicId || !pagesBelongToTopic)

  const selectAllPagination = useMemo<MessageListSelectAllPagination>(
    () => ({
      hasOlder: hasNext,
      isLoading: enabled && loadAllRequested && hasNext,
      start: startLoadAll,
      stop: stopLoadAll
    }),
    [enabled, hasNext, loadAllRequested, startLoadAll, stopLoadAll]
  )

  const displayIndex = useCallback((id: string) => positions.get(id)?.displayIndex, [positions])

  return {
    displayIndex,
    uiMessages,
    pathMessages,
    replyHistory,
    siblingsMap,
    isLoading: enabled && (isLoading || isStale),
    isStale,
    refresh,
    activeNodeId,
    loadOlder: loadNext,
    hasOlder: hasNext,
    selectAllPagination,
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
