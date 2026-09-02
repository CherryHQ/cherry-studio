import { useToolResult } from '@renderer/hooks/useToolResult'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useEffect, useMemo, useState } from 'react'

import { findAgentPreviewUrlCandidates, findAgentPreviewUrlInOutput } from './agentRightPaneProjection'

function buildSearchKey(sessionId: string | undefined, candidateKeys: string[]): string {
  return `${sessionId ?? ''}\0${candidateKeys.join('\0')}`
}

/** Identifies the ordered candidate set without materializing deferred outputs. */
export function getAgentPreviewUrlSearchKey(
  sessionId: string | undefined,
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): string {
  const candidates = sessionId ? findAgentPreviewUrlCandidates(messages, partsByMessageId) : []
  return buildSearchKey(
    sessionId,
    candidates.map((candidate) => candidate.key)
  )
}

/** Resolves deferred preview candidates one at a time until the newest available URL is known. */
export function useAgentPreviewUrl(
  enabled: boolean,
  sessionId: string | undefined,
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): { searchKey: string; url: string | null } {
  const candidates = useMemo(
    () => (enabled && sessionId ? findAgentPreviewUrlCandidates(messages, partsByMessageId) : []),
    [enabled, messages, partsByMessageId, sessionId]
  )
  const searchKey = buildSearchKey(
    sessionId,
    candidates.map((candidate) => candidate.key)
  )
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

  return { searchKey, url: resolvedUrl }
}
