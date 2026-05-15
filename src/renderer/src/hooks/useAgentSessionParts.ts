/**
 * Agent session history data source — returns CherryUIMessage[] for useChatWithHistory.
 *
 * Backed by DataApi (`/sessions/:sessionId/messages`) with cursor-based
 * infinite pagination so chat-style transcripts of arbitrary length load
 * incrementally as the virtual list scrolls up. Reads go through SWR's
 * shared cache (dedup, revalidation, cross-window consistency).
 *
 * After the blocks→parts migration each message row's `content` carries
 * `{ message: { id, role, data: { parts }, status, createdAt }, blocks }` —
 * we unwrap that shape and project to `CherryUIMessage`.
 */

import { useInfiniteFlatItems, useInfiniteQuery, useMutation } from '@renderer/data/hooks/useDataApi'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryMessagePart, CherryUIMessage, MessageStatus } from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'

const PAGE_SIZE = 50

const VALID_STATUS: ReadonlySet<MessageStatus> = new Set(['pending', 'success', 'error', 'paused'])

interface AgentMessageContent {
  message?: {
    id?: string
    role?: string
    status?: string
    data?: { parts?: CherryMessagePart[] }
    createdAt?: string
  }
}

function toUIMessage(row: AgentSessionMessageEntity): CherryUIMessage | null {
  const content = row.content as AgentMessageContent | undefined
  const msg = content?.message
  if (!msg?.id) return null

  const metadata: CherryUIMessage['metadata'] = {}
  if (msg.createdAt) metadata.createdAt = msg.createdAt
  if (msg.status && VALID_STATUS.has(msg.status as MessageStatus)) {
    metadata.status = msg.status as MessageStatus
  }

  return {
    id: msg.id,
    role: msg.role as CherryUIMessage['role'],
    parts: msg.data?.parts ?? [],
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  } as CherryUIMessage
}

export function useAgentSessionParts(_agentId: string, sessionId: string) {
  const sessionMessagesCachePath = `/sessions/${sessionId}/messages` as const
  const { pages, isLoading, hasNext, loadNext, mutate } = useInfiniteQuery('/sessions/:sessionId/messages', {
    params: { sessionId },
    limit: PAGE_SIZE,
    enabled: !!sessionId
  })
  const { trigger: deleteMessageTrigger } = useMutation('DELETE', '/sessions/:sessionId/messages/:messageId', {
    refresh: [sessionMessagesCachePath]
  })

  // Server returns each page newest-first (DESC) and the cursor walks older.
  // MessageVirtualList expects chronological-asc (oldest first), so reverse both
  // axes: oldest page first, and within each page reverse to ASC.
  const rows = useInfiniteFlatItems(pages, { reversePages: true, reverseItems: true })

  const messages = useMemo<CherryUIMessage[]>(() => {
    const out: CherryUIMessage[] = []
    for (const row of rows) {
      const ui = toUIMessage(row)
      if (ui) out.push(ui)
    }
    return out
  }, [rows])

  const refreshMessages = useCallback(async (): Promise<CherryUIMessage[]> => {
    const refreshedPages = await mutate()
    const flat: AgentSessionMessageEntity[] = []
    if (refreshedPages) {
      for (let i = refreshedPages.length - 1; i >= 0; i--) {
        const page = refreshedPages[i]
        for (let j = page.items.length - 1; j >= 0; j--) flat.push(page.items[j])
      }
    }
    const out: CherryUIMessage[] = []
    for (const row of flat) {
      const ui = toUIMessage(row)
      if (ui) out.push(ui)
    }
    return out
  }, [mutate])

  const deleteMessage = useCallback(
    async (messageId: string): Promise<void> => {
      await deleteMessageTrigger({ params: { sessionId, messageId } })
    },
    [deleteMessageTrigger, sessionId]
  )

  return {
    messages,
    isLoading,
    hasOlder: hasNext,
    loadOlder: loadNext,
    refresh: refreshMessages,
    deleteMessage
  }
}
