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
  /** messageId -> latest streamed parts from the execution overlay. */
  overlay: Record<string, CherryMessagePart[]>
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

/**
 * Canonical `onHandoff` callback for `useTopicOverlayHandoffOnTerminal`:
 * refresh the DB rows first so dropping the live overlay never flashes stale
 * base parts, and drop the overlay even when the refresh fails.
 */
export function createOverlayRefreshHandoff(refresh: () => Promise<unknown>, resetOverlay: () => void) {
  return async () => {
    try {
      await refresh()
    } finally {
      resetOverlay()
    }
  }
}

export function useMessageStreamingLayers({
  messages,
  overlay,
  executions,
  liveAssistants
}: MessageStreamingLayersParams): MessageStreamingLayersResult {
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
