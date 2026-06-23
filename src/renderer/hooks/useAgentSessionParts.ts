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

import { useInfiniteFlatItems, useInfiniteQuery, useMutation } from '@renderer/data/hooks/useDataApi'
import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'

const PAGE_SIZE = 50

export function toAgentSessionUIMessage(row: AgentSessionMessageEntity): CherryUIMessage {
  const metadata: CherryUIMessage['metadata'] = {}
  if (row.createdAt) metadata.createdAt = row.createdAt
  if (row.updatedAt) metadata.updatedAt = row.updatedAt
  metadata.status = row.status
  if (row.modelId) metadata.modelId = row.modelId
  if (row.modelSnapshot) metadata.modelSnapshot = row.modelSnapshot
  if (row.stats) metadata.stats = row.stats

  return {
    id: row.id,
    role: row.role,
    parts: row.data.parts ?? [],
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  } as CherryUIMessage
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
    modelSnapshot: metadata.modelSnapshot ?? null,
    stats: metadata.stats ?? null,
    runtimeResumeToken: null,
    createdAt,
    updatedAt: createdAt
  }
}

export function useAgentSessionParts(sessionId: string, options: { enabled?: boolean; fetchOnMount?: boolean } = {}) {
  const enabled = !!sessionId && options.enabled !== false
  const fetchOnMount = options.fetchOnMount ?? enabled
  const sessionMessagesCachePath = `/agent-sessions/${sessionId}/messages` as const
  const { pages, isLoading, hasNext, loadNext, mutate } = useInfiniteQuery('/agent-sessions/:sessionId/messages', {
    params: { sessionId },
    limit: PAGE_SIZE,
    enabled,
    swrOptions: {
      ...(!fetchOnMount && {
        revalidateIfStale: false,
        revalidateOnMount: false
      })
    }
  })
  const { trigger: deleteMessageTrigger } = useMutation('DELETE', '/agent-sessions/:sessionId/messages/:messageId', {
    refresh: [sessionMessagesCachePath]
  })

  // Server returns each page newest-first (DESC) and the cursor walks older.
  // MessageVirtualList expects chronological-asc (oldest first), so reverse both
  // axes: oldest page first, and within each page reverse to ASC.
  const rows = useInfiniteFlatItems(pages, { reversePages: true, reverseItems: true })

  const messages = useMemo<CherryUIMessage[]>(() => {
    return rows.map(toAgentSessionUIMessage)
  }, [rows])

  const refreshMessages = useCallback(async (): Promise<CherryUIMessage[]> => {
    if (!enabled) return []
    const refreshedPages = await mutate()
    const flat: AgentSessionMessageEntity[] = []
    if (refreshedPages) {
      for (let i = refreshedPages.length - 1; i >= 0; i--) {
        const page = refreshedPages[i]
        for (let j = page.items.length - 1; j >= 0; j--) flat.push(page.items[j])
      }
    }
    return flat.map(toAgentSessionUIMessage)
  }, [enabled, mutate])

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
      await deleteMessageTrigger({ params: { sessionId, messageId } })
    },
    [deleteMessageTrigger, sessionId]
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
