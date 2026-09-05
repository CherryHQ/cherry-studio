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

import { useSharedCacheSelector } from '@renderer/data/hooks/useCache'
import {
  useDataChange,
  useInfiniteFlatItems,
  useMutation,
  useWriteInfiniteCache
} from '@renderer/data/hooks/useDataApi'
import { AGENT_SESSION_FLOW_PARTS_CACHE_KEY } from '@shared/ai/agentSessionFlowParts'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useCallback, useMemo, useRef } from 'react'

import { useConversationHistoryQuery } from './useConversationHistoryQuery'

const PAGE_SIZE = 50

interface CachedAgentSessionMessage {
  liveParts: CherryMessagePart[] | undefined
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
  } as CherryUIMessage
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

function reservedUIMessageToAgentSessionMessage(
  sessionId: string,
  message: CherryUIMessage
): AgentSessionMessageEntity {
  const metadata = message.metadata ?? {}
  const createdAt = metadata.createdAt ?? new Date().toISOString()
  return {
    id: message.id,
    sessionId,
    role: message.role,
    data: { parts: (message.parts ?? []) as CherryMessagePart[] },
    searchableText: '',
    status:
      metadata.status ?? (message.role === 'assistant' && (message.parts?.length ?? 0) === 0 ? 'pending' : 'success'),
    modelId: metadata.modelId ?? null,
    messageSnapshot: metadata.messageSnapshot ?? null,
    stats: metadata.stats ?? null,
    runtimeResumeToken: null,
    delivery: metadata.delivery ?? null,
    createdAt,
    updatedAt: createdAt
  }
}

export function useAgentSessionParts(sessionId: string, options: { enabled?: boolean; fetchOnMount?: boolean } = {}) {
  const enabled = !!sessionId && options.enabled !== false
  const fetchOnMount = options.fetchOnMount ?? enabled
  const sessionMessagesCachePath = `/agent-sessions/${sessionId}/messages` as const
  const { pages, isLoading, hasNext, loadNext, mutate } = useConversationHistoryQuery(
    '/agent-sessions/:sessionId/messages',
    {
      params: { sessionId },
      // Render-only read: a long session's tool outputs stay in main until a card actually needs one.
      query: { deferToolOutputs: true },
      limit: PAGE_SIZE,
      enabled,
      swrOptions: {
        keepPreviousData: false,
        ...(!fetchOnMount && {
          revalidateIfStale: false,
          revalidateOnMount: false
        })
      }
    }
  )
  const { trigger: deleteMessageTrigger } = useMutation('DELETE', '/agent-sessions/:sessionId/messages/:messageId', {
    refresh: [sessionMessagesCachePath]
  })
  const writeSessionMessagesCache = useWriteInfiniteCache('/agent-sessions/:sessionId/messages', {
    params: { sessionId },
    query: { deferToolOutputs: true },
    limit: PAGE_SIZE
  })
  const inFlightDeletePromisesRef = useRef(new Map<string, Promise<void>>())
  const locallyRemovedIdsRef = useRef({ ids: new Set<string>(), sessionId })
  if (locallyRemovedIdsRef.current.sessionId !== sessionId) {
    locallyRemovedIdsRef.current = { ids: new Set<string>(), sessionId }
  }
  const locallyRemovedIds = locallyRemovedIdsRef.current.ids
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
        const cached = previousById?.get(row.id)
        if (
          cached?.sessionId === row.sessionId &&
          cached.updatedAt === row.updatedAt &&
          cached.role === row.role &&
          cached.status === row.status &&
          cached.modelId === row.modelId &&
          cached.liveParts === liveParts
        ) {
          nextById.set(row.id, cached)
          return cached.message
        }

        const message = toAgentSessionUIMessage(row)
        const projectedMessage = liveParts ? { ...message, parts: liveParts } : message
        nextById.set(row.id, {
          liveParts,
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
    [flowParts, projectionOwnerToken]
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

  const seedReservedMessages = useCallback(
    async (messages: CherryUIMessage[]): Promise<void> => {
      const reservedRows = messages.map((message) => reservedUIMessageToAgentSessionMessage(sessionId, message))
      if (reservedRows.length === 0) return

      await mutate(
        (pages?: CursorPaginationResponse<AgentSessionMessageEntity>[]) => {
          const currentPages = pages?.length ? pages : [{ items: [], nextCursor: undefined }]
          const existingIds = new Set(currentPages.flatMap((page) => page.items.map((item) => item.id)))
          const newRows = reservedRows.filter((row) => !existingIds.has(row.id))
          if (newRows.length === 0) return pages

          const newestFirst = newRows
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
          const nextPages = currentPages.slice()
          const firstPage = nextPages[0]
          nextPages[0] = {
            ...firstPage,
            items: [...newestFirst, ...firstPage.items]
          }
          return nextPages
        },
        { revalidate: false }
      )
    },
    [mutate, sessionId]
  )

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

      const deletePromise = (async () => {
        await deleteMessageTrigger({ params: { sessionId, messageId } })
        locallyRemovedIds.add(messageId)
        await writeSessionMessagesCache((currentPages) => dropSessionMessageFromPages(currentPages, messageId))
      })()
      inFlightDeletePromisesRef.current.set(deleteKey, deletePromise)
      try {
        await deletePromise
      } finally {
        inFlightDeletePromisesRef.current.delete(deleteKey)
      }
    },
    [deleteMessageTrigger, locallyRemovedIds, pages, sessionId, writeSessionMessagesCache]
  )

  return {
    messages,
    isLoading: enabled && isLoading,
    hasOlder: hasNext,
    loadOlder: loadNext,
    refresh: refreshMessages,
    seedReservedMessages,
    deleteMessage
  }
}
