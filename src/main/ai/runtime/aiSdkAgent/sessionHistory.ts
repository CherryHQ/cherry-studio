/**
 * Durable per-turn replay for the AI SDK agent runtime (plan D2/D4/D10).
 *
 * The AI SDK has no remote session handle: every turn rebuilds the model
 * conversation from SQLite. `listRuntimeHistory` supplies the replayable rows
 * strictly before the incoming user row's `(createdAt, id)` tuple — busy
 * follow-ups are persisted before they queue, so the exclusive boundary is
 * what keeps the current prompt from duplicating and future queued prompts
 * from leaking into this turn. When a compaction checkpoint exists, the rows
 * at or before its anchor are represented by the stored summary and only
 * post-anchor rows replay verbatim. The incoming message is appended here
 * exactly once; model conversion (dangling tool calls, data-only parts, empty
 * turns) stays in the existing `toModelMessages` rules inside `Agent.stream`.
 */

import type { AgentSessionRuntimeStateRow } from '@data/db/schemas/agentSessionRuntimeState'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionRuntimeStateService } from '@data/services/AgentSessionRuntimeStateService'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryUIMessage } from '@shared/data/types/message'

import { buildAgentUserContent } from '../agentUserContent'
import { parseManualCompactCommand } from '../compactCommand'
import type { AgentRuntimeUserInput } from '../types'

/** The `runtime_type` this driver stamps on its durable compaction state. */
export const AI_SDK_RUNTIME_TYPE = 'ai-sdk'

/**
 * Build the full UIMessage input for one turn: stored summary (when a
 * compaction checkpoint exists), bounded durable history, and the incoming
 * user message. Throws (`Message not found`) when the incoming row is not
 * durable — a production AI SDK turn requires the persisted user row as its
 * replay boundary; there is no synthetic-turn fallback.
 */
export function buildTurnMessages(sessionId: string, input: AgentRuntimeUserInput): CherryUIMessage[] {
  const { state, rows } = loadReplayContext(sessionId, input.message.id)
  return [...(state ? [buildSummaryUiMessage(state)] : []), ...rows.map(toReplayUiMessage), toIncomingUiMessage(input)]
}

/**
 * The shared replay row selection: compaction-anchor lower bound plus the
 * `/compact` filter. `compaction.ts` summarizes exactly what this returns, so
 * replay and summarization can never disagree about which rows are live.
 *
 * Persisted `/compact` user rows are excluded — they are stored as ordinary
 * user text but are commands to Cherry, not conversation (pi never sees them
 * either: its replay is SDK-internal). No paired assistant row exists for a
 * compact turn, so dropping the user row drops the whole exchange.
 */
export function loadReplayContext(
  sessionId: string,
  beforeMessageId: string
): { state: AgentSessionRuntimeStateRow | null; rows: AgentSessionMessageEntity[] } {
  const state = agentSessionRuntimeStateService.getState(sessionId, AI_SDK_RUNTIME_TYPE)
  const rows = agentSessionMessageService.listRuntimeHistory(sessionId, {
    beforeMessageId,
    ...(state ? { afterMessageId: state.compactedThroughMessageId } : {})
  })
  return { state, rows: rows.filter((row) => !isCompactCommandRow(row)) }
}

/** Project durable rows onto the UIMessages the model replay consumes (exported for `compaction.ts`). */
export function toReplayUiMessages(rows: readonly AgentSessionMessageEntity[]): CherryUIMessage[] {
  return rows.map(toReplayUiMessage)
}

/**
 * The stored summary enters the model conversation as one synthetic user
 * message — the same shape compaction feeds back into the next summarization,
 * so repeated compaction folds prior summaries instead of losing them.
 */
export function buildSummaryUiMessage(state: AgentSessionRuntimeStateRow): CherryUIMessage {
  return {
    id: `compaction-summary-${state.compactedThroughMessageId}`,
    role: 'user',
    parts: [
      {
        type: 'text',
        text: `The earlier part of this conversation was compacted. This summary replaces everything before this point:\n\n${state.summary}`
      }
    ]
  } as CherryUIMessage
}

function isCompactCommandRow(row: AgentSessionMessageEntity): boolean {
  return row.role === 'user' && parseManualCompactCommand(buildAgentUserContent(row)) !== undefined
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
