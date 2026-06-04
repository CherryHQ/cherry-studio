import type { CherryMessagePart } from '@shared/data/types/message'
import { isToolUIPart } from 'ai'

import type { ApprovalDecision } from './stream'

/**
 * Apply approval decisions onto a `UIMessage.parts` array, flipping the
 * matching `ToolUIPart` from `approval-requested` → `approval-responded`
 * with the user's choice.
 *
 * Pure helper — no IPC, no DB. Both renderer (writing the optimistic /
 * authoritative DB PATCH) and main (legacy callers) use it on the same
 * shape. Decisions whose `approvalId` doesn't match any
 * `approval-requested` part are silently ignored (already settled, or the
 * click pre-dated a stream that advanced past it). Returns a new array
 * even when no parts change, to keep callers copy-on-write.
 */
export function applyApprovalDecisions(
  parts: readonly CherryMessagePart[],
  decisions: readonly ApprovalDecision[]
): CherryMessagePart[] {
  if (decisions.length === 0) return [...parts]
  const byApprovalId = new Map<string, ApprovalDecision>()
  for (const d of decisions) byApprovalId.set(d.approvalId, d)

  return parts.map((part) => {
    if (!isToolUIPart(part)) return part
    const id = part.approval?.id
    if (!id) return part
    if (part.state !== 'approval-requested') return part
    const decision = byApprovalId.get(id)
    if (!decision) return part
    return {
      ...part,
      state: 'approval-responded',
      approval: {
        id: decision.approvalId,
        approved: decision.approved,
        ...(decision.reason !== undefined ? { reason: decision.reason } : {})
      }
    } as CherryMessagePart
  })
}
