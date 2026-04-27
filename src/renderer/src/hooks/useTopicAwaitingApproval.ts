/**
 * Derive "topic is paused waiting for the user to approve a tool" from the
 * two state machines that meet at this question:
 *  - the ActiveStream lifecycle (`useTopicStreamStatus`) — must NOT be live
 *  - any rendered message has at least one `ToolUIPart` in
 *    `state: 'approval-requested'`
 */

import { usePartsMap } from '@renderer/pages/home/Messages/Blocks/V2Contexts'
import { isToolUIPart } from 'ai'
import { useMemo } from 'react'

import { useTopicStreamStatus } from './useTopicStreamStatus'

export function useTopicAwaitingApproval(topicId: string): boolean {
  const { status: streamStatus } = useTopicStreamStatus(topicId)
  const partsMap = usePartsMap()

  const hasPendingApproval = useMemo(() => {
    if (!partsMap) return false
    for (const parts of Object.values(partsMap)) {
      for (const part of parts) {
        if (!isToolUIPart(part)) continue
        if (part.state === 'approval-requested') return true
      }
    }
    return false
  }, [partsMap])

  if (streamStatus === 'pending' || streamStatus === 'streaming') return false
  return hasPendingApproval
}
