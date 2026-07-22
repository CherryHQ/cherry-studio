/**
 * Persistence backend strategy — the storage-specific half of
 * `PersistenceListener`. Concrete backends live near the storage domain
 * they write to; stream-manager only owns the generic contract.
 *
 * The listener attaches error parts and composes `MessageStats` before
 * calling the backend — backends never synthesise UIMessages or repeat
 * projection logic.
 */

import { PREPARE_TIMELINE_FOOTER_THRESHOLD_MS, type PrepareProgressPartData } from '@shared/ai/agentPrepareTimeline'
import type { CherryMessagePart, CherryUIMessage, MessageStats } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { type CherryReasoningMeta, readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'

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
    if (part.type === 'reasoning') {
      if (part.state === 'streaming') {
        const cherry = readCherryMeta(part)
        const startedAt = cherry?.startedAt
        const thinkingMs = cherry?.thinkingMs

        let patch: Partial<CherryReasoningMeta> = {}
        if (typeof startedAt === 'number' && Number.isFinite(startedAt) && !Number.isFinite(thinkingMs)) {
          patch = {
            thinkingMs: Math.max(0, Date.now() - startedAt)
          }
        }

        // TODO(stream-manager-redesign): AI SDK's ReasoningUIPart currently only supports 'streaming' | 'done'.
        // Investigate expanding the state machine with an 'error' terminal state.
        return withCherryMeta(
          {
            ...part,
            state: 'done'
          },
          patch
        )
      }
      return part
    }

    if (!isToolPart(part)) return part
    const toolPart = part as CherryMessagePart & { state?: string; errorText?: string }
    if (toolPart.state && TERMINAL_TOOL_STATES.has(toolPart.state)) return part
    return { ...toolPart, state: 'output-error', errorText: toolPart.errorText ?? reason } as CherryMessagePart
  })
}

/**
 * Drop parts that carry no renderable content — empty/whitespace-only `text`
 * and `reasoning` parts. The AI SDK accumulator can leave these behind at step
 * boundaries (e.g. a final text step that produced no output); persisting them
 * yields invisible message blocks that still inject layout spacing on render.
 *
 * Returns the original array by reference when nothing is dropped, so a clean
 * turn keeps a stable identity (matching `finalizeInterruptedParts`).
 */
export function dropEmptyContentParts(parts: CherryMessagePart[]): CherryMessagePart[] {
  const filtered = parts.filter((part) => {
    if (part.type !== 'text' && part.type !== 'reasoning') return true
    return part.text.trim().length > 0
  })
  return filtered.length === parts.length ? parts : filtered
}

/**
 * Drop a `data-prepare-progress` part unless it carries a finalized timeline above the renderer's
 * display threshold — the only state the post-hoc breakdown ever shows. Sub-threshold timelines and
 * phase-only leftovers (a turn that errored before finalize) are one-off live-progress data; the
 * structured log line already recorded them, so persisting them would be dead weight in every row.
 *
 * Returns the original array by reference when nothing is dropped (matching `dropEmptyContentParts`).
 */
export function dropSubThresholdPrepareParts(parts: CherryMessagePart[]): CherryMessagePart[] {
  const filtered = parts.filter((part) => {
    if ((part.type as string) !== 'data-prepare-progress') return true
    const timeline = (part as { data?: PrepareProgressPartData }).data?.timeline
    return !!timeline && timeline.totalMs > PREPARE_TIMELINE_FOOTER_THRESHOLD_MS
  })
  return filtered.length === parts.length ? parts : filtered
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

  /**
   * True for backends that finalize a pre-created placeholder row. They must
   * still write terminal status when a stream is paused before producing chunks.
   */
  readonly canPersistEmptyTerminal?: boolean

  persistAssistant(input: PersistAssistantInput): void

  /**
   * Best-effort recovery when `persistAssistant` throws: drive the backing
   * placeholder row to a terminal `error` state so a reload shows a terminal
   * bubble instead of a frozen `pending` one. Only backends that finalize a
   * pre-existing placeholder (e.g. `MessageServiceBackend`) implement this.
   */
  markTerminalError?(): void

  /** Best-effort post-success hook; failures are swallowed by the listener. */
  afterPersist?(finalMessage: CherryUIMessage): Promise<void>
}

/**
 * Token counts come from `finalMessage.metadata` (populated by
 * agentLoop's `messageMetadata` on the `finish` chunk). Durations come
 * from the merged `StatsTimings`, rounded to integer ms.
 *
 * `timeThinkingMs` is deliberately not projected: the
 * `reasoningStartedAt → reasoningEndedAt` wall-clock can include
 * interleaved tool execution. The subtraction path lands with the
 * `TODO(message-stats-redesign)` rework in `src/shared/data/types/message.ts`.
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
    if (typeof meta.noCacheTokens === 'number') stats.noCacheTokens = meta.noCacheTokens
    if (typeof meta.cacheReadTokens === 'number') stats.cacheReadTokens = meta.cacheReadTokens
    if (typeof meta.cacheWriteTokens === 'number') stats.cacheWriteTokens = meta.cacheWriteTokens
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
