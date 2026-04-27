/**
 * Apply approval decisions onto DB-authoritative `UIMessage.parts`.
 *
 * Cherry runs the approval protocol entirely on Main: the renderer hands
 * Main an `(approvalId, approved, reason?)` triple via the
 * `Ai_ToolApproval_Respond` IPC; Main reads the DB anchor and uses this
 * helper to flip the matching `ToolUIPart` from `approval-requested` →
 * `approval-responded`.
 *
 * Lives in main rather than `packages/shared/ai/transport/` because it's
 * a pure helper Main calls on its own DB rows — it has no role in the
 * renderer↔main IPC contract. (`ApprovalDecision` itself stays in the
 * shared transport package because it IS the IPC payload shape.)
 *
 * Assumes AI SDK v6's `ToolUIPart` shape:
 *   { state: 'approval-requested',  approval: { id }            }
 *   { state: 'approval-responded',  approval: { id, approved, reason? } }
 */

import type { ApprovalDecision } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'
import { isToolUIPart } from 'ai'

/**
 * Take the DB-authoritative parts and apply each decision, flipping the
 * matching `ToolUIPart` from `approval-requested` → `approval-responded`
 * with the user's choice.
 *
 * Decisions whose `approvalId` doesn't match any `approval-requested` part
 * are silently ignored (e.g. the approval already settled, or the click
 * pre-dated a stream that advanced past it). The returned array is a new
 * reference even when no parts change, to keep call sites copy-on-write.
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
