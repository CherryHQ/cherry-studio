/**
 * In-memory observability ring buffer for tool-approval decisions.
 *
 * Holds the last `MAX_RECENT` approval/denial decisions per topic so the
 * context-chef `dynamicState` slot can inject them as a system message
 * on the next LLM iteration. Without this hint the model has zero
 * explicit signal that an approval just landed and tends to stall,
 * skip, or hallucinate the user's choice.
 *
 * Per-process and unbounded across topic count by design — entries are
 * trivially small (~200B each × MAX_RECENT × active topics) and
 * `recentDecisions` is a hint, not source of truth (the canonical
 * approval state lives in message history). Loss on restart is fine.
 *
 * Pending approvals currently return `[]` (V1). Cherry has no DB row
 * for "currently pending in this topic" — pending state lives in
 * `ToolApprovalRegistry` (Claude Agent path, in-memory) and as
 * `approval-requested` parts on the anchor message (MCP path, derivable
 * from history). Adding a real query is deferred until concrete UX
 * surfaces require it; for now `recentDecisions` alone is the warmest
 * signal the model needs.
 */

import { loggerService } from '@logger'

const logger = loggerService.withContext('ApprovalObservability')

const MAX_RECENT = 5

export interface ApprovalDecisionEntry {
  toolName: string
  toolCallId: string
  decision: 'approved' | 'denied'
  /** ISO 8601 timestamp. */
  decidedAt: string
  reason?: string
}

export interface PendingApproval {
  toolName: string
  toolCallId: string
  /** ISO 8601 timestamp. */
  requestedAt: string
  /** First ~80 chars of tool args, for context. */
  preview?: string
}

export interface ApprovalDynamicState {
  pendingApprovals: PendingApproval[]
  recentDecisions: ApprovalDecisionEntry[]
}

/** Most-recent-first per topic. Capped at MAX_RECENT, oldest evicted. */
const recent = new Map<string, ApprovalDecisionEntry[]>()

/**
 * Record a user decision. Caller responsibility — wire from wherever
 * the approval IPC handler / decision flow lives, immediately AFTER
 * the existing state mutation.
 */
export function recordDecision(topicId: string, entry: ApprovalDecisionEntry): void {
  if (!topicId) {
    logger.debug('recordDecision called with empty topicId — skipping', {
      toolName: entry.toolName,
      toolCallId: entry.toolCallId
    })
    return
  }
  const list = recent.get(topicId) ?? []
  list.unshift(entry)
  if (list.length > MAX_RECENT) list.length = MAX_RECENT
  recent.set(topicId, list)
}

/** Drop topic state — call when a topic is deleted. */
export function clearTopic(topicId: string): void {
  recent.delete(topicId)
}

/**
 * Returns the current approval state for the given topic. Empty arrays
 * (rather than `undefined`) when the topic has nothing pending and no
 * recent decisions — callers decide whether to skip injection.
 */
export function getApprovalState(topicId: string): ApprovalDynamicState {
  return {
    pendingApprovals: queryPendingApprovals(topicId),
    recentDecisions: recent.get(topicId) ?? []
  }
}

function queryPendingApprovals(_topicId: string): PendingApproval[] {
  // V1: no DB-backed pending list. `ToolApprovalRegistry` (Claude Agent
  // path) is keyed by `approvalId` not topicId, and MCP-path pending
  // approvals live as `approval-requested` parts on anchor messages
  // (derivable from history). Returning [] is acceptable — the model
  // already sees pending parts in the rendered history; the warmer
  // signal we need is `recentDecisions`.
  //
  // TODO: when a concrete UX or model failure mode demands it, expose
  // a topic-scoped pending query. Likely either:
  //   - extend `ToolApprovalRegistry` with a `listByTopic(topicId)`,
  //     once `topicId` is threaded into `register()` (it isn't today —
  //     the registry only knows `sessionId`); or
  //   - scan the active topic's anchor parts for `approval-requested`
  //     state via the message service.
  return []
}
