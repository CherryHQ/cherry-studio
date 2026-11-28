/**
 * Agent session history data source — returns CherryUIMessage[] for useChatWithHistory.
 *
 * Backed by DataApi (`/agent-sessions/:sessionId/messages`) with cursor-based
 * infinite pagination so chat-style transcripts of arbitrary length load
 * incrementally as the virtual list scrolls up. Reads go through SWR's
 * shared cache (dedup, revalidation, cross-window consistency).
 *
 * Each message row stores parts directly in `data`, matching regular topic
 * messages. Row fields carry identity, role, status, and timestamps.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { dataApiService } from '@data/DataApiService'
import { useSharedCacheSelector } from '@renderer/data/hooks/useCache'
import {
  useDataChange,
  useMutation,
  useReadCache,
  useWriteInfiniteCache,
  useWriteInfinitePage
} from '@renderer/data/hooks/useDataApi'
import type { MessageListSelectAllPagination } from '@renderer/types/message'
import { AGENT_SESSION_TURN_ORIGIN_CACHE_KEY, type AutonomousTurnOrigin } from '@shared/ai/agentSessionTurnOrigin'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { useHistoryPageProjection } from './historyPageLayout'
import { useConversationHistoryQuery } from './useConversationHistoryQuery'
import { type PageRows, useHistoryRowUpdates } from './useHistoryRowUpdates'

const PAGE_SIZE = 50
const HISTORY_QUERY = { deferToolOutputs: true } as const

const sessionRows: PageRows<AgentSessionMessageEntity, AgentSessionMessageEntity> = {
  get: (items, { item }) => items[item],
  replace: (items, { item }, row) => items.with(item, row)
}

type SessionPage = CursorPaginationResponse<AgentSessionMessageEntity>
type TurnOrigins = Record<string, AutonomousTurnOrigin | undefined>
const noTurnOrigins: TurnOrigins = {}
const keepMembership = <T>(current: T) => current

async function readAppendedPages(
  path: `/agent-sessions/${string}/messages`,
  pages: SessionPage[],
  announced: ReadonlySet<string>
): Promise<SessionPage[] | undefined> {
  const [first, second] = pages
  if (!first?.items.length) return
  const added = new Set(announced)
  for (const page of pages) for (const row of page.items) added.delete(row.id)
  if (!added.size) return

  // Keep the first page full and carry any short page directly behind it.
  const carry = second && second.items.length < PAGE_SIZE ? second : undefined
  const before = carry ? [...first.items, ...carry.items] : first.items
  const boundary = (carry ?? first).nextCursor ?? undefined
  const addedCount = added.size
  const total = addedCount + before.length
  const prefix: SessionPage[] = []
  let cursor: string | undefined
  let offset = 0
  while (offset < total) {
    const remaining = total - offset
    const limit = offset === PAGE_SIZE ? remaining % PAGE_SIZE || PAGE_SIZE : PAGE_SIZE
    if (offset > addedCount && remaining <= PAGE_SIZE) {
      prefix.push({ items: before.slice(offset - addedCount), nextCursor: boundary })
      break
    }
    const page = await dataApiService.get(path as '/agent-sessions/:sessionId/messages', {
      query: { ...HISTORY_QUERY, limit, cursor }
    })
    if (page.items.length !== Math.min(limit, remaining)) return
    for (const row of page.items) {
      const matches = offset < addedCount ? added.delete(row.id) : before[offset - addedCount]?.id === row.id
      if (!matches) return
      offset++
    }
    cursor = page.nextCursor ?? undefined
    if (offset < total ? !cursor : cursor !== boundary) return
    prefix.push(page)
  }
  return [...prefix, ...pages.slice(carry ? 2 : 1)]
}

function sessionMembership(pages: SessionPage[]) {
  const ids: string[] = []
  const excluded = new Set<string>()
  const byId = new Map<string, { index: number; page: number; item: number }>()
  for (let page = pages.length - 1; page >= 0; page--) {
    for (let item = pages[page].items.length - 1; item >= 0; item--) {
      const row = pages[page].items[item]
      const id = row.id
      for (const sibling of row.siblings ?? []) if (sibling !== id) excluded.add(sibling)
      byId.set(id, { index: ids.length, page, item })
      ids.push(id)
    }
  }
  return { ids, byId, excluded }
}

export function toAgentSessionUIMessage(row: AgentSessionMessageEntity): CherryUIMessage {
  const metadata: CherryUIMessage['metadata'] = {}
  if (row.createdAt) metadata.createdAt = row.createdAt
  if (row.updatedAt) metadata.updatedAt = row.updatedAt
  metadata.status = row.status
  if (row.data.importedHistory) metadata.importedHistory = row.data.importedHistory
  if (row.modelId) metadata.modelId = row.modelId
  if (row.messageSnapshot) metadata.messageSnapshot = row.messageSnapshot
  if (row.provenance) metadata.provenance = row.provenance
  if (row.stats) metadata.stats = row.stats
  if (row.delivery) metadata.delivery = row.delivery

  return {
    id: row.id,
    role: row.role,
    parts: row.data.parts ?? [],
    partIds: row.partIds,
    partPositions: row.partPositions,
    timeline: { pos: row.pos, replyId: row.replyId },
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  }
}

function dropSessionMessageFromPages(
  pages: CursorPaginationResponse<AgentSessionMessageEntity>[] | undefined,
  messageId: string
): CursorPaginationResponse<AgentSessionMessageEntity>[] | undefined {
  if (!pages) return pages
  let mutated = false
  const nextPages = pages.map((page) => {
    const items = page.items.filter((item) => item.id !== messageId)
    if (items.length === page.items.length) return page
    mutated = true
    return { ...page, items }
  })
  return mutated ? nextPages : pages
}

export function useAgentSessionParts(sessionId: string, options: { enabled?: boolean; fetchOnMount?: boolean } = {}) {
  const enabled = !!sessionId && options.enabled !== false
  const fetchOnMount = options.fetchOnMount ?? enabled
  // Load-all mode (multi-select "select all"): auto-paginate to the oldest
  // page — same pattern as `useTopics({ loadAll: true })`. `loadNext` is
  // fire-and-forget (its promise is dropped inside useDataApi), so a failed
  // page fetch is detected via the query `error` and abandons load-all
  // instead of retrying on every render; the user can re-trigger select-all.
  const [loadAllRequested, setLoadAllRequested] = useState(false)
  const stopLoadAll = useCallback(() => setLoadAllRequested(false), [])
  useEffect(() => {
    stopLoadAll()
  }, [sessionId, stopLoadAll])
  const {
    pages,
    isLoading,
    isRefreshing,
    error,
    hasNext,
    loadNext,
    mutate,
    refresh: refreshPages
  } = useConversationHistoryQuery('/agent-sessions/:sessionId/messages', {
    params: { sessionId },
    // Render-only read: a long session's tool outputs stay in main until a card actually needs one.
    query: HISTORY_QUERY,
    limit: PAGE_SIZE,
    enabled,
    swrOptions: {
      keepPreviousData: false,
      // Paging to the end must not revalidate the first page on every step;
      // restored once the load-all finishes.
      revalidateFirstPage: !loadAllRequested,
      ...(!fetchOnMount && {
        revalidateIfStale: false,
        revalidateOnMount: false
      })
    }
  })
  const { trigger: deleteMessageTrigger } = useMutation('DELETE', '/agent-sessions/:sessionId/messages/:messageId', {
    refresh: ({ args }) => [`/agent-sessions/${args!.params.sessionId}/messages`]
  })
  const { trigger: selectBranchTrigger } = useMutation('PUT', '/agent-sessions/:sessionId/branch')
  const setActiveBranch = useCallback(
    async (messageId: string) => {
      await selectBranchTrigger({ params: { sessionId }, body: { messageId } })
      await mutate()
    },
    [mutate, selectBranchTrigger, sessionId]
  )
  const writeSessionMessagesCache = useWriteInfiniteCache('/agent-sessions/:sessionId/messages', {
    params: { sessionId },
    query: HISTORY_QUERY,
    limit: PAGE_SIZE
  })
  const inFlightDeletePromisesRef = useRef(new Map<string, Promise<void>>())
  const deleteQueuesRef = useRef(new Map<string, Promise<void>>())
  const locallyRemovedIds = useMemo(() => ({ ids: new Set<string>(), sessionId }), [sessionId]).ids
  const writePage = useWriteInfinitePage('/agent-sessions/:sessionId/messages', {
    params: { sessionId },
    query: HISTORY_QUERY,
    limit: PAGE_SIZE
  })
  const readCache = useReadCache()
  const path = `/agent-sessions/${sessionId}/messages` as const
  const readPages = useCallback(
    () => readCache<SessionPage[]>(path, HISTORY_QUERY, { limit: PAGE_SIZE }),
    [path, readCache]
  )
  const prependPages = useCallback(
    async (
      ids: ReadonlySet<string>,
      canCommit: (pages: SessionPage[]) => boolean
    ): Promise<SessionPage[] | undefined> => {
      const cached = readPages()
      if (!cached?.length) return
      const next = await readAppendedPages(path, cached, ids)
      return next && canCommit(cached) ? writeSessionMessagesCache(next, cached) : undefined
    },
    [path, readPages, writeSessionMessagesCache]
  )
  const readRow = useCallback(
    async (id: string) => {
      const row = await dataApiService.get(`/agent-sessions/${sessionId}/messages/${id}`, {
        query: { deferToolOutputs: true }
      })
      if (!('sessionId' in row) || row.sessionId !== sessionId)
        throw new Error('History row does not belong to the session')
      return row
    },
    [sessionId]
  )
  const membership = useHistoryPageProjection(pages, sessionMembership, keepMembership)
  const { replyHistory, onChange, refreshMembership } = useHistoryRowUpdates(
    pages,
    membership.byId,
    sessionRows,
    readRow,
    writePage,
    sessionId,
    refreshPages,
    membership.excluded,
    prependPages
  )
  const refreshReservedMessages = useCallback(
    async (ids: readonly string[]) => {
      if (!enabled) return
      const pages = readPages() ?? []
      const missing = ids.filter((id) => !pages.some(({ items }) => items.some((row) => row.id === id)))
      if (missing.length) await refreshMembership(missing, { append: true })
    },
    [enabled, readPages, refreshMembership]
  )
  useDataChange(
    '/agent-sessions/:sessionId/messages',
    (effects) => {
      if (enabled) onChange(effects)
    },
    { routeParams: { sessionId } }
  )

  const getMessageSiblings = useCallback(
    (messageId: string) => {
      const slot = membership.byId.get(messageId)
      const ids = slot && pages[slot.page].items[slot.item].siblings
      return ids && ids.length > 1 ? { group: ids.map((id) => ({ id })), activeIndex: ids.indexOf(messageId) } : null
    },
    [membership, pages]
  )
  const turnOriginKeys = useMemo(
    () => (enabled ? membership.ids.map((id) => AGENT_SESSION_TURN_ORIGIN_CACHE_KEY(sessionId, id)) : []),
    [enabled, membership, sessionId]
  )
  const selectTurnOrigins = useCallback(
    (values: readonly (AutonomousTurnOrigin | null | undefined)[]) => {
      let origins = noTurnOrigins
      values.forEach((value, i) => {
        if (!value) return
        if (origins === noTurnOrigins) origins = {}
        origins[membership.ids[i]] = value
      })
      return origins
    },
    [membership]
  )
  const turnOrigins = useSharedCacheSelector(turnOriginKeys, selectTurnOrigins)
  const projected = useRef(new WeakMap<AgentSessionMessageEntity, CherryUIMessage>()).current
  const project = useCallback(
    (row: AgentSessionMessageEntity) => {
      const origin = turnOrigins[row.id]
      const cached = projected.get(row)
      if (cached && cached.metadata?.turnOrigin === origin) return cached
      const message = toAgentSessionUIMessage(row)
      if (origin) message.metadata = { ...message.metadata, turnOrigin: origin }
      projected.set(row, message)
      return message
    },
    [projected, turnOrigins]
  )
  const build = useCallback(
    (pages: SessionPage[]) => {
      const messages: CherryUIMessage[] = []
      const persistedPartsByMessageId: Record<string, CherryMessagePart[]> = {}
      const historyActions: Record<string, AgentSessionMessageEntity['historyActions']> = {}
      for (let page = pages.length - 1; page >= 0; page--) {
        for (let item = pages[page].items.length - 1; item >= 0; item--) {
          const row = pages[page].items[item]
          const message = project(row)
          messages.push(message)
          persistedPartsByMessageId[row.id] = message.parts
          historyActions[row.id] = row.historyActions
        }
      }
      return { messages, persistedPartsByMessageId, historyActions }
    },
    [project]
  )
  const replace = useCallback(
    (view: ReturnType<typeof build>, changes: AgentSessionMessageEntity[]) => {
      const messages = view.messages.slice()
      const persistedPartsByMessageId = { ...view.persistedPartsByMessageId }
      let historyActions = view.historyActions
      for (const row of changes) {
        const index = membership.byId.get(row.id)?.index
        if (index === undefined) return
        const message = project(row)
        messages[index] = message
        persistedPartsByMessageId[row.id] = message.parts
        if (historyActions[row.id] !== row.historyActions) {
          if (historyActions === view.historyActions) historyActions = { ...historyActions }
          historyActions[row.id] = row.historyActions
        }
      }
      return { messages, persistedPartsByMessageId, historyActions }
    },
    [membership, project]
  )
  const { messages, persistedPartsByMessageId, historyActions } = useHistoryPageProjection(pages, build, replace)

  const refresh = useCallback(async () => {
    if (enabled) await refreshPages({ throwOnError: true })
  }, [enabled, refreshPages])

  const revalidate = useCallback(async () => {
    await mutate()
  }, [mutate])
  const displayIndex = useCallback((id: string) => membership.byId.get(id)?.index, [membership])

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

  const deleteMessage = useCallback(
    async (messageId: string): Promise<void> => {
      const deleteKey = `${sessionId}:${messageId}`
      if (locallyRemovedIds.has(messageId)) {
        await writeSessionMessagesCache((currentPages) => dropSessionMessageFromPages(currentPages, messageId))
        return
      }
      const inFlightDelete = inFlightDeletePromisesRef.current.get(deleteKey)
      if (inFlightDelete) return inFlightDelete
      if (!pages.some((page) => page.items.some((item) => item.id === messageId))) return

      const performDelete = async () => {
        await deleteMessageTrigger({ params: { sessionId, messageId } })
        locallyRemovedIds.add(messageId)
        await writeSessionMessagesCache((currentPages) => dropSessionMessageFromPages(currentPages, messageId))
      }
      const previousDelete = deleteQueuesRef.current.get(sessionId)
      const deletePromise = previousDelete ? previousDelete.catch(() => undefined).then(performDelete) : performDelete()
      deleteQueuesRef.current.set(sessionId, deletePromise)
      inFlightDeletePromisesRef.current.set(deleteKey, deletePromise)
      try {
        await deletePromise
      } finally {
        inFlightDeletePromisesRef.current.delete(deleteKey)
        if (deleteQueuesRef.current.get(sessionId) === deletePromise) deleteQueuesRef.current.delete(sessionId)
      }
    },
    [deleteMessageTrigger, locallyRemovedIds, pages, sessionId, writeSessionMessagesCache]
  )

  const selectAllPagination = useMemo<MessageListSelectAllPagination>(
    () => ({
      hasOlder: hasNext,
      isLoading: enabled && loadAllRequested && hasNext,
      start: startLoadAll,
      stop: stopLoadAll
    }),
    [enabled, hasNext, loadAllRequested, startLoadAll, stopLoadAll]
  )

  return {
    messages,
    replyHistory,
    historyActions,
    getMessageSiblings,
    setActiveBranch,
    persistedPartsByMessageId,
    isLoading: enabled && isLoading,
    hasOlder: hasNext,
    loadOlder: loadNext,
    selectAllPagination,
    refresh,
    revalidate,
    refreshReservedMessages,
    displayIndex,
    deleteMessage
  }
}
