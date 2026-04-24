/**
 * Agent session history data source — returns CherryUIMessage[] for useChatWithHistory.
 *
 * Backed by DataApi (`/agents/:agentId/sessions/:sessionId/messages`) so
 * reads go through the shared SWR cache (dedup, revalidation, cross-window
 * consistency) instead of ad-hoc IPC + local state.
 *
 * After the blocks→parts migration each message row's `content` carries
 * `{ message: { id, role, data: { parts }, status, createdAt }, blocks }` —
 * we unwrap that shape and project to `CherryUIMessage`.
 */

import { useQuery } from '@renderer/data/hooks/useDataApi'
import type { AgentSessionMessageEntity } from '@renderer/types/agent'
import type { CherryMessagePart, CherryUIMessage, MessageStatus } from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'

const FETCH_LIMIT = 999

const VALID_STATUS: ReadonlySet<MessageStatus> = new Set(['pending', 'success', 'error', 'paused'])

/**
 * Minimal shape the renderer needs from `row.content`. The schema stores it
 * as `z.unknown()` so it stays generic on the service layer; every field is
 * optional because un-migrated rows or future writers may omit any of them.
 */
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

export function useAgentSessionParts(agentId: string, sessionId: string) {
  const { data, isLoading, mutate } = useQuery('/agents/:agentId/sessions/:sessionId/messages', {
    params: { agentId, sessionId },
    query: { limit: FETCH_LIMIT },
    enabled: !!agentId && !!sessionId
  })

  const messages = useMemo<CherryUIMessage[]>(() => {
    const rows = data?.items ?? []
    const out: CherryUIMessage[] = []
    for (const row of rows) {
      const ui = toUIMessage(row)
      if (ui) out.push(ui)
    }
    return out
  }, [data])

  const refresh = useCallback(async (): Promise<CherryUIMessage[]> => {
    const refreshed = await mutate()
    const rows = refreshed?.items ?? []
    const out: CherryUIMessage[] = []
    for (const row of rows) {
      const ui = toUIMessage(row)
      if (ui) out.push(ui)
    }
    return out
  }, [mutate])

  return { messages, isLoading, refresh }
}
