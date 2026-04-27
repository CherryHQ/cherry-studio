/**
 * Derive "topic is paused waiting for the user to approve a tool" from the
 * two state machines that meet at this question:
 *  - the ActiveStream lifecycle (`useTopicStreamStatus`) — must NOT be live
 *  - the last assistant message — must contain at least one `ToolUIPart`
 *    in `state: 'approval-requested'`
 *
 * The fact "this turn is waiting on user approval" is encoded directly on
 * the relevant `ToolUIPart`, not duplicated as a `metadata.status` rollup,
 * so we just scan parts here. Each machine stays single-purpose; this hook
 * is the explicit join point UI consumers (Inputbar disabled hint, message
 * bubble badge, sidebar indicator) read from. Don't recompute the join in
 * each consumer — keep it here so the rule lives in one place.
 */

import type { CherryUIMessage } from '@shared/data/types/message'
import { isToolUIPart } from 'ai'
import { useMemo } from 'react'

import { useTopicStreamStatus } from './useTopicStreamStatus'

export function useTopicAwaitingApproval(topicId: string, uiMessages: readonly CherryUIMessage[]): boolean {
  const { status: streamStatus } = useTopicStreamStatus(topicId)

  const lastAssistantHasPendingApproval = useMemo(() => {
    for (let i = uiMessages.length - 1; i >= 0; i--) {
      const m = uiMessages[i]
      if (m.role !== 'assistant') continue
      for (const part of m.parts ?? []) {
        if (!isToolUIPart(part)) continue
        if (part.state === 'approval-requested') return true
      }
      return false
    }
    return false
  }, [uiMessages])

  if (streamStatus === 'pending' || streamStatus === 'streaming') return false
  return lastAssistantHasPendingApproval
}
