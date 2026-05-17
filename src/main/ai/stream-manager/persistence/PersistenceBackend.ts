/**
 * Persistence backend strategy — the storage-specific half of a
 * `PersistenceListener`.
 *
 * Three implementations cover the three Cherry Studio chat topologies:
 *  - `MessageServiceBackend`    — SQLite message tree (Persistent topics)
 *  - `TemporaryChatBackend`     — in-memory topic (Temporary topics)
 *  - `AgentMessageBackend`      — agents DB `session_messages` (Agent sessions)
 *
 * `success` / `paused` / `error` are the three terminal statuses of an
 * execution, and they all share a single accumulated `finalMessage`
 * (produced by the manager's execution loop via `readUIMessageStream`). The
 * listener is responsible for attaching an error part to the message
 * before calling the backend, so backends never need to know how to
 * synthesise an error-shaped UIMessage — they just persist whatever
 * accumulated parts they receive with the right status.
 *
 * Stats composition (tokens + timings → `MessageStats`) also lives in
 * the listener — backends receive the final `stats` ready-to-store and
 * never repeat the projection logic.
 */

import type { CherryMessagePart, CherryUIMessage, MessageStats } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import type { SemanticTimings, TransportTimings } from '../types'

const TERMINAL_TOOL_STATES: ReadonlySet<string> = new Set(['output-available', 'output-error', 'output-denied'])

function isToolPart(part: CherryMessagePart): boolean {
  const t = part.type
  return t.startsWith('tool-') || t === 'dynamic-tool'
}

export function finalizeInterruptedParts(
  parts: CherryMessagePart[],
  status: 'success' | 'paused' | 'error'
): CherryMessagePart[] {
  if (status === 'success') return parts
  const reason = status === 'paused' ? 'Interrupted by user' : 'Stream errored before tool completed'
  return parts.map((part) => {
    if (!isToolPart(part)) return part
    const toolPart = part as CherryMessagePart & { state?: string; errorText?: string }
    if (toolPart.state && TERMINAL_TOOL_STATES.has(toolPart.state)) return part
    return { ...toolPart, state: 'output-error', errorText: toolPart.errorText ?? reason } as CherryMessagePart
  })
}

/**
 * Merged timings for stats projection. `TransportTimings` comes from the
 * stream-manager execution loop; `SemanticTimings` comes from the listener that
 * observes chunk payloads (today `PersistenceListener`).
 */
export type StatsTimings = TransportTimings & SemanticTimings

export interface PersistAssistantInput {
  /**
   * Accumulated UIMessage for this execution. May be undefined when the
   * stream errored before producing any chunks. Backends that cannot
   * persist an empty message should ignore those cases and warn.
   */
  finalMessage?: CherryUIMessage
  status: 'success' | 'paused' | 'error'
  /** Set when the topic is multi-model, so backends can tell executions apart. */
  modelId?: UniqueModelId
  /**
   * Composed `MessageStats` ready to persist. Produced by the listener via
   * `statsFromTerminal(finalMessage, timings)`; backends write it as-is
   * without any per-backend projection logic.
   */
  stats?: MessageStats
}

export interface PersistenceBackend {
  /** Human-readable tag for logging/diagnostics (e.g. "sqlite", "temp", "agents-db"). */
  readonly kind: string

  /** Persist the terminal assistant turn in any of the three statuses. */
  persistAssistant(input: PersistAssistantInput): Promise<void>

  /**
   * Optional post-success hook. Called only after `persistAssistant` with
   * `status: 'success'` resolves cleanly. Failures are swallowed by the
   * listener (best-effort, never retried).
   */
  afterPersist?(finalMessage: CherryUIMessage): Promise<void>
}

/**
 * Project terminal data onto `MessageStats`:
 *  - token counts come from `finalMessage.metadata` (agentLoop's
 *    `messageMetadata` callback populates these on the `finish` chunk;
 *    see `CherryUIMessageMetadata` for the field mapping);
 *  - durations come from the merged `StatsTimings` (monotonic
 *    `performance.now()` deltas, rounded to integer milliseconds).
 *    Transport fields (`startedAt` / `completedAt`) are filled by the
 *    stream-manager execution loop; semantic fields (`firstTextAt` /
 *    `reasoning*`) are filled by the calling listener — see
 *    `PersistenceListener` for the canonical producer.
 *
 * `timeThinkingMs` is intentionally **not** projected: the underlying
 * `reasoningStartedAt` → `reasoningEndedAt` wall-clock can include tool
 * execution time that interleaves reasoning and text chunks. Writing a
 * polluted "thinking time" to the DB would be worse than leaving the
 * column empty — see the `stream-stats-followup` TODO in `agentLoop.ts`
 * for the precise subtraction path using AI SDK's
 * `onToolCallFinish.durationMs`.
 */
export function statsFromTerminal(
  finalMessage: CherryUIMessage | undefined,
  timings: StatsTimings | undefined
): MessageStats | undefined {
  const stats: MessageStats = {}

  const meta = finalMessage?.metadata
  if (meta && typeof meta === 'object') {
    if (typeof meta.totalTokens === 'number') stats.totalTokens = meta.totalTokens
    if (typeof meta.promptTokens === 'number') stats.promptTokens = meta.promptTokens
    if (typeof meta.completionTokens === 'number') stats.completionTokens = meta.completionTokens
    if (typeof meta.thoughtsTokens === 'number') stats.thoughtsTokens = meta.thoughtsTokens
  }

  if (timings) {
    if (timings.firstTextAt != null) {
      stats.timeFirstTokenMs = Math.round(timings.firstTextAt - timings.startedAt)
    }
    if (timings.completedAt != null) {
      stats.timeCompletionMs = Math.round(timings.completedAt - timings.startedAt)
    }
    // timeThinkingMs deliberately omitted — see doc comment above.
  }

  return Object.keys(stats).length > 0 ? stats : undefined
}
