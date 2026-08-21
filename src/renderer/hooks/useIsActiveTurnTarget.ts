import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { isMessageListItemProcessing } from '@renderer/components/chat/messages/utils/messageListItem'
import { ConversationKind } from '@shared/ai/conversation'

import { useConversationStreamStatus } from './useConversationStreamStatus'

/**
 * Is THIS message the active target of the current turn?
 *
 * Single per-message identity predicate — the per-message equivalent of the
 * Conversation-level `classifyTurn`. Three authoritative non-staleable signals,
 * shaped identically (per-message DB status optimistic; the two Main-side
 * broadcast id-arrays for live vs awaiting), so consumers cannot rebuild
 * the OR and get it wrong:
 *
 *  1. `isMessageProcessing(message)` — DB `status` PENDING/PROCESSING/
 *     SEARCHING. Per-message; covers the freshly-sent assistant placeholder
 *     where the optimistic status is set before any shared-cache broadcast.
 *  2. `activeExecutions[].anchorMessageId === message.id` — shared-cache
 *     cross-window registry of live (`exec.status === 'streaming'`)
 *     executions. Covers the continue-stream tool-execution window where
 *     `message.status` hasn't been re-fetched by SWR yet.
 *  3. `awaitingInteractionExecutions[].outputNodeId === message.id` —
 *     shared-cache cross-window projection of executions waiting on an
 *     interaction. Main is the single authority for the output node's
 *     identity; the renderer no longer infers it from `message.parts`
 *     scans (retired) or a `status === 'paused'` proxy (which fails the
 *     MCP `needsApproval` flow that ends cleanly via `done`).
 *
 * Returns false for user messages and old completed assistants by
 * construction — none of the three signals match. Used wherever a consumer
 * gates "this message is busy / show beat-loader / hide menubar".
 */
export function useIsActiveTurnTarget(message: Pick<MessageListItem, 'id' | 'topicId' | 'status'>): boolean {
  const { activeExecutions, awaitingInteractionExecutions } = useConversationStreamStatus({
    kind: ConversationKind.Chat,
    id: message.topicId
  })
  if (isMessageListItemProcessing(message)) return true
  if (activeExecutions.some((execution) => execution.outputNodeId === message.id)) return true
  if (awaitingInteractionExecutions.some((execution) => execution.outputNodeId === message.id)) return true
  return false
}
