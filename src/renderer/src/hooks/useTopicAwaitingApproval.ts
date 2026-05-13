/**
 * Derive "topic is paused waiting for the user to approve a tool" from the
 * two state machines that meet at this question:
 *  - the ActiveStream lifecycle (`useTopicStreamStatus`) — must NOT be live
 *  - any rendered message has at least one `ToolUIPart` in
 *    `state: 'approval-requested'`
 */

import { usePartsMap } from '@renderer/components/chat/messages/Blocks/V2Contexts'
import { isToolUIPart } from 'ai'
import { useMemo } from 'react'

import { useTopicStreamStatus } from './useTopicStreamStatus'

export function useTopicAwaitingApproval(topicId: string): boolean {
  const { status: streamStatus } = useTopicStreamStatus(topicId)
  const partsMap = usePartsMap()

  // Fold the streamStatus short-circuit INTO the memo so the scan is
  // skipped while the stream is live (where partsMap churns per chunk).
  // Hook order forbids an early `return` between the hooks above and the
  // memo, so the gate has to live inside the dependency.
  return useMemo(() => {
    if (streamStatus === 'pending' || streamStatus === 'streaming') return false
    if (!partsMap) return false
    for (const parts of Object.values(partsMap)) {
      for (const part of parts) {
        if (!isToolUIPart(part)) continue
        if (part.state === 'approval-requested') return true
      }
    }
    return false
  }, [partsMap, streamStatus])
}
