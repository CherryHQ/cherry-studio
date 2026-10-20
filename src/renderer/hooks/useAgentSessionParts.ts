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

import { useSharedCacheSelector } from '@renderer/data/hooks/useCache'
import {
  useDataChange,
  useInfiniteFlatItems,
  useMutation,
  useWriteInfiniteCache
} from '@renderer/data/hooks/useDataApi'
import type { MessageListSelectAllPagination } from '@renderer/types/message'
import { AGENT_SESSION_FLOW_PARTS_CACHE_KEY } from '@shared/ai/agentSessionFlowParts'
import { AGENT_SESSION_TURN_ORIGIN_CACHE_KEY, type AutonomousTurnOrigin } from '@shared/ai/agentSessionTurnOrigin'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { useConversationHistoryQuery } from './useConversationHistoryQuery'

const PAGE_SIZE = 50

interface CachedAgentSessionMessage {
  liveParts: CherryMessagePart[] | undefined
  turnOrigin: AutonomousTurnOrigin | undefined
  message: CherryUIMessage
  modelId: AgentSessionMessageEntity['modelId']
  role: AgentSessionMessageEntity['role']
  sessionId: string
  status: AgentSessionMessageEntity['status']
  updatedAt: string
}

export function toAgentSessionUIMessage(row: AgentSessionMessageEntity): CherryUIMessage {
  const metadata: CherryUIMessage['metadata'] = {}
  if (row.createdAt) metadata.createdAt = row.createdAt
  if (row.updatedAt) metadata.updatedAt = row.updatedAt
  metadata.status = row.status
  if (row.modelId) metadata.modelId = row.modelId
  if (row.messageSnapshot) metadata.messageSnapshot = row.messageSnapshot
  if (row.stats) metadata.stats = row.stats
  if (row.delivery) metadata.delivery = row.delivery

  return {
    id: row.id,
    role: row.role,
    parts: row.data.parts ?? [],
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
  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, mutate } = useConversationHistoryQuery(
    '/agent-sessions/:sessionId/messages',
    {
      params: { sessionId },
      // Render-only read: a long session's tool outputs stay in main until a card actually needs one.
      query: { deferToolOutputs: true },
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
    }
  )
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
    query: { deferToolOutputs: true },
    limit: PAGE_SIZE
  })
  const inFlightDeletePromisesRef = useRef(new Map<string, Promise<void>>())
  const deleteQueuesRef = useRef(new Map<string, Promise<void>>())
  const locallyRemovedIds = useMemo(() => ({ ids: new Set<string>(), sessionId }), [sessionId]).ids
  useDataChange(
    '/agent-sessions/:sessionId/messages',
    () => {
      if (enabled) void mutate()
    },
    { routeParams: { sessionId } }
  )

  // Server returns each page newest-first (DESC) and the cursor walks older.
  // MessageVirtualList expects chronological-asc (oldest first), so reverse both
  // axes: oldest page first, and within each page reverse to ASC.
  const rows = useInfiniteFlatItems(pages, { reversePages: true, reverseItems: true })
  // The display projection below includes live flow parts; settlement must read the database rows.
  const persistedPartsByMessageId = useMemo<Record<string, CherryMessagePart[]>>(
    () => Object.fromEntries(rows.map((row) => [row.id, row.data.parts ?? []])),
    [rows]
  )
  const getMessageSiblings = useCallback(
    (messageId: string) => {
      const ids = rows.find((row) => row.id === messageId)?.siblings
      return ids && ids.length > 1 ? { group: ids.map((id) => ({ id })), activeIndex: ids.indexOf(messageId) } : null
    },
    [rows]
  )
  const loadedMessageIds = useMemo(() => (enabled ? rows.map((row) => row.id) : []), [enabled, rows])
  const flowPartsKeys = useMemo(
    () => loadedMessageIds.map((messageId) => AGENT_SESSION_FLOW_PARTS_CACHE_KEY(sessionId, messageId)),
    [loadedMessageIds, sessionId]
  )
  const selectFlowParts = useCallback(
    (values: readonly (CherryMessagePart[] | undefined)[]) =>
      Object.fromEntries(loadedMessageIds.map((messageId, index) => [messageId, values[index]])),
    [loadedMessageIds]
  )
  const flowParts = useSharedCacheSelector(flowPartsKeys, selectFlowParts)
  const turnOriginKeys = useMemo(
    () => loadedMessageIds.map((messageId) => AGENT_SESSION_TURN_ORIGIN_CACHE_KEY(sessionId, messageId)),
    [loadedMessageIds, sessionId]
  )
  const selectTurnOrigins = useCallback(
    (values: readonly (AutonomousTurnOrigin | null | undefined)[]) =>
      Object.fromEntries(loadedMessageIds.map((messageId, index) => [messageId, values[index] ?? undefined])),
    [loadedMessageIds]
  )
  const turnOrigins = useSharedCacheSelector(turnOriginKeys, selectTurnOrigins)

  const messageProjectionRef = useRef<
    | {
        byId: Map<string, CachedAgentSessionMessage>
        messages: CherryUIMessage[]
        ownerToken: symbol
      }
    | undefined
  >(undefined)
  const projectionOwnerToken = useMemo(() => Symbol(sessionId), [sessionId])
  const currentProjectionOwnerTokenRef = useRef(projectionOwnerToken)
  currentProjectionOwnerTokenRef.current = projectionOwnerToken
  // `updatedAt` is the persisted row revision. Reuse unchanged projections so
  // downstream WeakMap caches and message-group memoization survive revalidation.
  const projectMessages = useCallback(
    (sourceRows: AgentSessionMessageEntity[]): CherryUIMessage[] => {
      const previousProjection = messageProjectionRef.current
      const previousById = previousProjection?.ownerToken === projectionOwnerToken ? previousProjection.byId : undefined
      const nextById = new Map<string, CachedAgentSessionMessage>()
      const nextMessages = sourceRows.map((row) => {
        const liveParts = flowParts[row.id]
        const turnOrigin = turnOrigins[row.id]
        const cached = previousById?.get(row.id)
        if (
          cached?.sessionId === row.sessionId &&
          cached.updatedAt === row.updatedAt &&
          cached.role === row.role &&
          cached.status === row.status &&
          cached.modelId === row.modelId &&
          cached.liveParts === liveParts &&
          cached.turnOrigin === turnOrigin
        ) {
          nextById.set(row.id, cached)
          return cached.message
        }

        const message = toAgentSessionUIMessage(row)
        const withOrigin = turnOrigin ? { ...message, metadata: { ...message.metadata, turnOrigin } } : message
        const projectedMessage = liveParts ? { ...withOrigin, parts: liveParts } : withOrigin
        nextById.set(row.id, {
          liveParts,
          turnOrigin,
          message: projectedMessage,
          modelId: row.modelId,
          role: row.role,
          sessionId: row.sessionId,
          status: row.status,
          updatedAt: row.updatedAt
        })
        return projectedMessage
      })
      const previousMessages =
        previousProjection?.ownerToken === projectionOwnerToken ? previousProjection.messages : undefined
      const stableMessages =
        previousMessages !== undefined &&
        previousMessages.length === nextMessages.length &&
        nextMessages.every((message, index) => message === previousMessages[index])
          ? previousMessages
          : nextMessages
      if (currentProjectionOwnerTokenRef.current === projectionOwnerToken) {
        messageProjectionRef.current = { byId: nextById, messages: stableMessages, ownerToken: projectionOwnerToken }
      }
      return stableMessages
    },
    [flowParts, turnOrigins, projectionOwnerToken]
  )

  const messages = useMemo<CherryUIMessage[]>(() => {
    return projectMessages(rows)
  }, [projectMessages, rows])

  const refreshMessages = useCallback(async (): Promise<CherryUIMessage[]> => {
    if (!enabled) return []
    const fallbackMessages =
      messageProjectionRef.current?.ownerToken === projectionOwnerToken ? messageProjectionRef.current.messages : []
    const refreshedPages = await mutate()
    if (!refreshedPages) return fallbackMessages
    const flat: AgentSessionMessageEntity[] = []
    for (let i = refreshedPages.length - 1; i >= 0; i--) {
      const page = refreshedPages[i]
      for (let j = page.items.length - 1; j >= 0; j--) flat.push(page.items[j])
    }
    return projectMessages(flat)
  }, [enabled, mutate, projectMessages, projectionOwnerToken])

  // A reservation can arrive after branch selection. Only Main's selected path may enter this cache.
  const seedReservedMessages = useCallback<(messages: CherryUIMessage[]) => Promise<void>>(async () => {
    await mutate()
  }, [mutate])
  const replaceMessageTail = useCallback<
    (messageId: string, replacements: CherryUIMessage[]) => Promise<void>
  >(async () => {
    await mutate()
  }, [mutate])

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
    getMessageSiblings,
    setActiveBranch,
    persistedPartsByMessageId,
    isLoading: enabled && isLoading,
    hasOlder: hasNext,
    loadOlder: loadNext,
    selectAllPagination,
    refresh: refreshMessages,
    seedReservedMessages,
    replaceMessageTail,
    deleteMessage
  }
}
