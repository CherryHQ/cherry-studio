/**
 * Persistence backend strategy — the storage-specific half of
 * `PersistenceListener`. Concrete backends live near the storage domain
 * they write to; stream-manager only owns the generic contract.
 *
 * The listener attaches error parts and composes `MessageStats` before
 * calling the backend — backends never synthesise UIMessages or repeat
 * projection logic.
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

export type StatsTimings = TransportTimings & SemanticTimings

export interface PersistAssistantInput {
  /** Undefined when the stream errored before producing any chunks. */
  finalMessage?: CherryUIMessage
  status: 'success' | 'paused' | 'error'
  /** Set when the topic is multi-model. */
  modelId?: UniqueModelId
  stats?: MessageStats
}

export interface PersistenceBackend {
  /** Tag for logging (e.g. "sqlite", "temp", "agents-db"). */
  readonly kind: string

  persistAssistant(input: PersistAssistantInput): Promise<void>

  /**
   * Best-effort recovery when `persistAssistant` throws: drive the backing
   * placeholder row to a terminal `error` state so a reload shows a terminal
   * bubble instead of a frozen `pending` one. Only backends that finalize a
   * pre-existing placeholder (e.g. `MessageServiceBackend`) implement this.
   */
  markTerminalError?(): Promise<void>

  /** Best-effort post-success hook; failures are swallowed by the listener. */
  afterPersist?(finalMessage: CherryUIMessage): Promise<void>
}

/**
 * Token counts come from `finalMessage.metadata` (populated by the usage
 * writers' `message-metadata` chunks): prefer the full nested `stats` snapshot
 * (carries the cache / output breakdown), falling back to the top-level scalar
 * mirrors. Durations come from the merged `StatsTimings`, rounded to integer
 * ms. Cost is NOT set here — it requires a DB pricing read and is added in the
 * async `MessageServiceBackend.enrichStatsWithCost`.
 *
 * `timeThinkingMs` is deliberately not projected: the
 * `reasoningStartedAt → reasoningEndedAt` wall-clock can include interleaved
 * tool execution.
 */
export function statsFromTerminal(
  finalMessage: CherryUIMessage | undefined,
  timings: StatsTimings | undefined
): MessageStats | undefined {
  const meta = finalMessage?.metadata

  // Nested snapshot is the source of truth (tokens + breakdown); scalars are a
  // fallback for any path that only set the top-level mirrors.
  const stats: MessageStats = meta?.stats ? structuredClone(meta.stats) : {}
  if (meta && typeof meta === 'object') {
    if (stats.totalTokens === undefined && typeof meta.totalTokens === 'number') stats.totalTokens = meta.totalTokens
    if (stats.inputTokens === undefined && typeof meta.inputTokens === 'number') stats.inputTokens = meta.inputTokens
    if (stats.outputTokens === undefined && typeof meta.outputTokens === 'number')
      stats.outputTokens = meta.outputTokens
    if (stats.reasoningTokens === undefined && typeof meta.reasoningTokens === 'number')
      stats.reasoningTokens = meta.reasoningTokens
  }

  if (timings) {
    if (timings.firstTextAt != null) {
      stats.timeFirstTokenMs = Math.round(timings.firstTextAt - timings.startedAt)
    }
    if (timings.completedAt != null) {
      stats.timeCompletionMs = Math.round(timings.completedAt - timings.startedAt)
    }
  }

  return Object.keys(stats).length > 0 ? stats : undefined
}
