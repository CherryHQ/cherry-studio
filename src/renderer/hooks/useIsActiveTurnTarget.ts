import type { MessageListItem } from '@renderer/components/chat/messages/types'
import type { Message } from '@renderer/types/newMessage'
import { isMessageProcessing } from '@renderer/utils/messageUtils/is'

import { useTopicStreamStatus } from './useTopicStreamStatus'

/**
 * Identity shape consumed by {@link useIsActiveTurnTarget}. Accepts both the
 * legacy v1 `Message` and the v2 `MessageListItem` (whose `status` is the
 * narrower {@link MessageStatus} union) so v1 and v2 message renderers can
 * share the predicate during the chat-page migration.
 */
type ActiveTurnTarget = Pick<Message, 'id' | 'topicId' | 'status'> | Pick<MessageListItem, 'id' | 'topicId' | 'status'>

/**
 * Is THIS message the active target of the current turn?
 *
 * Single per-message identity predicate — the per-message equivalent of the
 * topic-level `classifyTurn`. Three authoritative non-staleable signals,
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
 *  3. `awaitingApprovalAnchors[].anchorMessageId === message.id` —
 *     shared-cache cross-window registry of execs paused on a tool-approval
 *     request. Main is the single authority for the approval anchor's
 *     identity; the renderer no longer infers it from `message.parts`
 *     scans (retired) or a `status === 'paused'` proxy (which fails the
 *     MCP `needsApproval` flow that ends cleanly via `done`).
 *
 * Returns false for user messages and old completed assistants by
 * construction — none of the three signals match. Used wherever a consumer
 * gates "this message is busy / show beat-loader / hide menubar".
 */
export function useIsActiveTurnTarget(message: ActiveTurnTarget): boolean {
  const { activeExecutions, awaitingApprovalAnchors } = useTopicStreamStatus(message.topicId)
  if (isMessageProcessing(message)) return true
  if (activeExecutions.some((e) => e.anchorMessageId === message.id)) return true
  if (awaitingApprovalAnchors.some((e) => e.anchorMessageId === message.id)) return true
  return false
}
