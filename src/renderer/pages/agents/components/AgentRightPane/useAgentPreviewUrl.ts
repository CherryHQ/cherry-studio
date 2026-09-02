import { useToolResult } from '@renderer/hooks/useToolResult'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useEffect, useMemo, useState } from 'react'

import { findAgentPreviewUrlCandidates, findAgentPreviewUrlInOutput } from './agentRightPaneProjection'

/** Resolves deferred preview candidates one at a time until the newest available URL is known. */
export function useAgentPreviewUrl(
  sessionId: string | undefined,
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): string | null {
  const candidates = useMemo(
    () => (sessionId ? findAgentPreviewUrlCandidates(messages, partsByMessageId) : []),
    [messages, partsByMessageId, sessionId]
  )
  const searchKey = `${sessionId ?? ''}\0${candidates.map((candidate) => candidate.key).join('\0')}`
  const [cursor, setCursor] = useState({ searchKey, index: 0 })
  const index = cursor.searchKey === searchKey ? cursor.index : 0
  const candidate = candidates[index]
  const deferredRef = candidate?.type === 'deferred' ? candidate.ref : undefined
  const { output, isLoading } = useToolResult(deferredRef)
  const resolvedUrl =
    candidate?.type === 'url'
      ? candidate.url
      : candidate?.type === 'deferred' && !isLoading
        ? findAgentPreviewUrlInOutput(output)
        : null

  useEffect(() => {
    if (cursor.searchKey !== searchKey) {
      setCursor({ searchKey, index: 0 })
      return
    }
    if (candidate?.type !== 'deferred' || isLoading || resolvedUrl) return
    setCursor((current) =>
      current.searchKey === searchKey && current.index === index ? { searchKey, index: index + 1 } : current
    )
  }, [candidate, cursor.searchKey, index, isLoading, resolvedUrl, searchKey])

  return resolvedUrl
}
