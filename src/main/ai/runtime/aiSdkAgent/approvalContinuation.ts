/**
 * Approval-continuation helpers for the ai-sdk runtime (plan D8).
 *
 * The AI SDK's approval protocol is request → terminate → restart: a gated
 * tool is never executed, the segment stream ends after emitting
 * `tool-approval-request`, and the NEXT execution call runs the approved
 * tools when the converted history carries the approval responses. These
 * helpers turn one drained segment into that continuation input: rebuild the
 * segment's assistant UIMessage with the SDK's own reducer, then flip each
 * requested part to `approval-responded` with the renderer's decision.
 *
 * `updatedInput` has no SDK channel (`tool-approval-response` carries only
 * approved/reason), so an edited input is applied by patching the tool
 * part's `input` before the continuation — the rebuilt model view sees the
 * patched call, equivalent to pi's in-process `applyInputEdit`.
 */

import type { UIMessage, UIMessageChunk } from 'ai'
import { readUIMessageStream } from 'ai'

import type { DispatchDecision } from '../toolApproval/ToolApprovalRegistry'

/** One intercepted `tool-approval-request`, awaiting its renderer (or auto) decision. */
export interface PendingApprovalRequest {
  approvalId: string
  toolCallId: string
  toolName: string
  decision: Promise<DispatchDecision>
}

export interface SettledApproval {
  request: PendingApprovalRequest
  decision: DispatchDecision
}

/**
 * Rebuild the turn's assistant UIMessage from a segment's buffered raw
 * chunks using the SDK's own stream reducer, so part states (including
 * `approval-requested` + `approval.id`) match exactly what a client chat
 * would hold. `seed` carries the accumulated message of the previous
 * segments: a continuation emits `tool-output-available` for tools whose
 * `tool-input-*` chunks belong to an earlier segment, and the reducer
 * throws on outputs for unknown calls — seeding keeps the whole turn one
 * assistant message (the `start` case only overrides id/metadata; it does
 * not reset seeded state — verified against ai@6.0.143).
 */
export async function accumulateAssistantMessage(
  chunks: readonly UIMessageChunk[],
  seed?: UIMessage
): Promise<UIMessage> {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    }
  })
  let message: UIMessage | undefined
  for await (const snapshot of readUIMessageStream({ stream, message: seed })) {
    message = snapshot
  }
  if (!message) {
    throw new Error('ai-sdk approval continuation: segment produced no assistant message')
  }
  return message
}

type ApprovalToolPart = {
  type: string
  toolCallId?: string
  state?: string
  input?: unknown
  approval?: { id: string; approved?: boolean; reason?: string }
}

/**
 * Flip each requested tool part to `approval-responded` and patch an edited
 * input in place. `toModelMessages` then converts the block to the
 * assistant `tool-approval-request` + tool-role `tool-approval-response`
 * pair the SDK's `collectToolApprovals` consumes at the top of the next
 * segment. Ids stay untouched, so tool/approval ids remain stable across
 * the restart.
 */
export function applyApprovalDecisions(message: UIMessage, settled: readonly SettledApproval[]): UIMessage {
  const byToolCallId = new Map(settled.map((entry) => [entry.request.toolCallId, entry]))
  return {
    ...message,
    parts: message.parts.map((part) => {
      const candidate = part as ApprovalToolPart
      if (candidate.state !== 'approval-requested' || !candidate.toolCallId) return part
      const entry = byToolCallId.get(candidate.toolCallId)
      if (!entry) return part
      const { decision, request } = entry
      return {
        ...candidate,
        state: 'approval-responded',
        input: decision.approved && decision.updatedInput ? decision.updatedInput : candidate.input,
        approval: { id: request.approvalId, approved: decision.approved, reason: decision.reason }
      } as typeof part
    })
  }
}

/** The seven numeric fields `attachUsageObserver` projects into `message-metadata`. */
export type SegmentStats = Partial<
  Record<
    | 'totalTokens'
    | 'promptTokens'
    | 'completionTokens'
    | 'thoughtsTokens'
    | 'noCacheTokens'
    | 'cacheReadTokens'
    | 'cacheWriteTokens',
    number | undefined
  >
>

const STAT_KEYS: readonly (keyof SegmentStats)[] = [
  'totalTokens',
  'promptTokens',
  'completionTokens',
  'thoughtsTokens',
  'noCacheTokens',
  'cacheReadTokens',
  'cacheWriteTokens'
]

/**
 * `attachUsageObserver` resets its running total on every execution start,
 * so segment ≥ 2 metadata under-counts the turn. Adding the previous
 * segments' final totals keeps the turn-cumulative contract. A field stays
 * `undefined` only when both sides are absent.
 */
export function addSegmentStats(baseline: SegmentStats, stats: SegmentStats): SegmentStats {
  const merged: SegmentStats = { ...stats }
  for (const key of STAT_KEYS) {
    const left = baseline[key]
    const right = stats[key]
    merged[key] = left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0)
  }
  return merged
}
