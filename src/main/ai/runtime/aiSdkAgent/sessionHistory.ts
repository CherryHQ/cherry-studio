/**
 * Durable per-turn replay for the AI SDK agent runtime (plan D2/D4).
 *
 * The AI SDK has no remote session handle: every turn rebuilds the model
 * conversation from SQLite. `listRuntimeHistory` supplies the replayable rows
 * strictly before the incoming user row's `(createdAt, id)` tuple — busy
 * follow-ups are persisted before they queue, so the exclusive boundary is
 * what keeps the current prompt from duplicating and future queued prompts
 * from leaking into this turn. The incoming message is appended here exactly
 * once; model conversion (dangling tool calls, data-only parts, empty turns)
 * stays in the existing `toModelMessages` rules inside `Agent.stream`.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryUIMessage } from '@shared/data/types/message'

import { buildAgentUserContent } from '../agentUserContent'
import type { AgentRuntimeUserInput } from '../types'

/**
 * Build the full UIMessage input for one turn: bounded durable history plus
 * the incoming user message. Throws (`Message not found`) when the incoming
 * row is not durable — a production AI SDK turn requires the persisted user
 * row as its replay boundary; there is no synthetic-turn fallback.
 */
export function buildTurnMessages(sessionId: string, input: AgentRuntimeUserInput): CherryUIMessage[] {
  const rows = agentSessionMessageService.listRuntimeHistory(sessionId, { beforeMessageId: input.message.id })
  return [...rows.map(toReplayUiMessage), toIncomingUiMessage(input)]
}

/**
 * Project a durable row onto the UIMessage the model replay consumes.
 * User rows are flattened through the driver-neutral attachment rule
 * (absolute file paths appended as text — filesystem agents read attachments
 * with their own tools); assistant rows keep their persisted parts verbatim
 * so completed tool calls/results replay and `toModelMessages` strips the
 * rest (data-* UI parts, dangling calls of failed turns) — except unresolved
 * approval states, which are sanitized below.
 */
function toReplayUiMessage(row: AgentSessionMessageEntity): CherryUIMessage {
  if (row.role === 'user') {
    return {
      id: row.id,
      role: 'user',
      parts: [{ type: 'text', text: buildAgentUserContent(row) }]
    } as CherryUIMessage
  }
  return {
    id: row.id,
    role: row.role,
    parts: (row.data?.parts ?? []).map(sanitizeReplayedPart)
  } as CherryUIMessage
}

type ReplayedPart = NonNullable<NonNullable<AgentSessionMessageEntity['data']>['parts']>[number]

/**
 * A turn that died mid-approval persists tool parts in `approval-requested`
 * or `approval-responded` state with no output. Replaying those verbatim is
 * unsafe: an unanswered/denied request converts to a dangling `tool_use`
 * (provider error), and an approved-but-unexecuted part would re-execute a
 * stale tool via `collectToolApprovals` on an unrelated later turn. Both flip
 * to `output-denied`, which converts to a plain error tool-result.
 * (`ignoreIncompleteToolCalls` does not strip approval states — verified
 * against ai@6.0.143.)
 */
function sanitizeReplayedPart(part: ReplayedPart): ReplayedPart {
  const candidate = part as { type?: string; state?: string; approval?: { id: string; reason?: string } }
  const isToolPart =
    typeof candidate.type === 'string' && (candidate.type.startsWith('tool-') || candidate.type === 'dynamic-tool')
  if (!isToolPart || !candidate.approval) return part
  if (candidate.state !== 'approval-requested' && candidate.state !== 'approval-responded') return part
  return {
    ...(part as object),
    state: 'output-denied',
    output: undefined,
    errorText: undefined,
    approval: {
      id: candidate.approval.id,
      approved: false,
      reason: candidate.approval.reason ?? 'Approval was not resolved before the turn ended.'
    }
  } as ReplayedPart
}

/** The current prompt. A `systemReminder` input is a re-queued steer (invariant 7): it reaches
 *  the model wrapped as a redirect instead of a fresh prompt, mirroring the other drivers. */
function toIncomingUiMessage(input: AgentRuntimeUserInput): CherryUIMessage {
  const text = buildAgentUserContent(input.message)
  return {
    id: input.message.id,
    role: 'user',
    parts: [{ type: 'text', text: input.systemReminder ? wrapSteerReminder(text) : text }]
  } as CherryUIMessage
}
