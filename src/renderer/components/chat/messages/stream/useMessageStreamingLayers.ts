/**
 * Shared assembly of the streaming projection consumed by `MessageList`:
 * stable part layers (via {@link useStableMessagePartsLayers}), the live
 * message-id set, and the `streamingLayers` contract object. Home and Agent
 * runtime-state hooks both derive their list inputs through this hook so the
 * two surfaces cannot drift.
 */

import { useMemo } from 'react'

import { useStableStringArray } from '@renderer/hooks/useStableStringArray'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import type { MessageStreamingLayers } from '../types'
import { useStableMessagePartsLayers } from './useStableMessagePartsLayers'

interface MessageStreamingLayersParams {
  messages: CherryUIMessage[]
  /** Executions whose anchor rows mark the mutable streaming tail. */
  executions: readonly ActiveExecution[]
  /** Latest assistant snapshot per execution. */
  liveAssistants: CherryUIMessage[]
}

interface MessageStreamingLayersResult {
  partsByMessageId: Record<string, CherryMessagePart[]>
  liveMessageIds: readonly string[]
  streamingLayers: MessageStreamingLayers
}

export function useMessageStreamingLayers({
  messages,
  executions,
  liveAssistants
}: MessageStreamingLayersParams): MessageStreamingLayersResult {
  const overlay = useMemo(
    () =>
      Object.fromEntries(
        liveAssistants.filter((row) => row.parts.length || row.partIds).map((row) => [row.id, row.parts])
      ),
    [liveAssistants]
  )
  const { historyPartsByMessageId, partsByMessageId } = useStableMessagePartsLayers(messages, overlay)
  const liveMessageIdCandidates = useMemo(
    () =>
      Array.from(
        new Set([
          ...executions.flatMap((execution) => (execution.anchorMessageId ? [execution.anchorMessageId] : [])),
          ...liveAssistants.map((message) => message.id)
        ])
      ),
    [executions, liveAssistants]
  )
  const liveMessageIds = useStableStringArray(liveMessageIdCandidates)
  const streamingLayers = useMemo<MessageStreamingLayers>(
    () => ({ historyPartsByMessageId, liveMessageIds }),
    [historyPartsByMessageId, liveMessageIds]
  )

  return { partsByMessageId, liveMessageIds, streamingLayers }
}
