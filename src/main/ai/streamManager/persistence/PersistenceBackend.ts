/**
 * Persistence backend strategy — the storage-specific half of
 * `PersistenceListener`. Concrete backends live near the storage domain
 * they write to; stream-manager only owns the generic contract.
 *
 * The listener attaches error parts, terminalizes interrupted parts, and
 * extracts message-owned runtime stats before calling the backend — backends
 * never synthesise UIMessages or repeat projection logic.
 */

import { isToolUIPart } from 'ai'

import type { CherryMessagePart, CherryUIMessage, MessageRuntimeStatsInput } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { type CherryReasoningMeta, readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'

const TERMINAL_TOOL_STATES: ReadonlySet<string> = new Set(['output-available', 'output-error', 'output-denied'])

/**
 * Drop transient status parts that must never reach storage. `data-retry`
 * (model retry/fallback status) is emitted live for the renderer but is not
 * part of the assistant's answer, so it is stripped before persistence.
 * Returns the same array reference when nothing was removed.
 */
export function stripTransientStatusParts(parts: CherryMessagePart[]): CherryMessagePart[] {
  const filtered = parts.filter((part) => part.type !== 'data-retry')

  return filtered.length === parts.length ? parts : filtered
}

export function finalizeInterruptedParts(
  parts: CherryMessagePart[],
  status: 'success' | 'paused' | 'error'
): CherryMessagePart[] {
  if (status === 'success') return parts
  const interruptionReason = status === 'paused' ? 'Interrupted by user' : 'Stream errored'
  const taskError = status === 'paused' ? interruptionReason : `${interruptionReason} before task completed`
  const toolError = status === 'paused' ? interruptionReason : `${interruptionReason} before tool completed`

  return parts.map((part): CherryMessagePart => {
    // A `text` part left `streaming` by a mid-response failure renders as a still-typing
    // cursor instead of the truncated sentence the user actually received.
    if (part.type === 'text') {
      return part.state === 'streaming' ? { ...part, state: 'done' } : part
    }

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

    if (part.type === 'data-agent-task-event') {
      if (part.data.status !== 'in_progress') return part

      return {
        ...part,
        data: {
          ...part.data,
          status: 'error',
          error: part.data.error ?? taskError
        }
      }
    }

    if (!isToolUIPart(part)) return part

    if (part.state && TERMINAL_TOOL_STATES.has(part.state)) return part

    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Interrupted approvals and historical fields survive; output-error deliberately exceeds the SDK union requiring approved:true.
    return {
      ...part,
      state: 'output-error',
      errorText: part.errorText ?? toolError
    } as CherryMessagePart
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

export interface PersistAssistantInput {
  /** Undefined when the stream errored before producing any chunks. */
  finalMessage?: CherryUIMessage
  status: 'success' | 'paused' | 'error'
  /** Set when the topic is multi-model. */
  modelId?: UniqueModelId
  runtimeStats?: MessageRuntimeStatsInput
}

export interface PersistedAssistant {
  messageId: string
  messageRevision: string
  historyRevision: string
}

export interface PersistenceBackend {
  /** Tag for logging (e.g. "sqlite", "temp", "agents-db"). */
  readonly kind: string

  /**
   * True for backends that finalize a pre-created placeholder row. They must
   * still write terminal status when a stream is paused before producing chunks.
   */
  readonly canPersistEmptyTerminal?: boolean

  /** True only when an empty successful response is itself a valid terminal result. */
  readonly canPersistEmptySuccessTerminal?: boolean

  persistAssistant(input: PersistAssistantInput): PersistedAssistant | void | Promise<PersistedAssistant | void>

  /**
   * Best-effort recovery when `persistAssistant` throws: drive the backing
   * placeholder row to a terminal `error` state so a reload shows a terminal
   * bubble instead of a frozen `pending` one. Backends that finalize a
   * pre-existing placeholder implement this.
   */
  markTerminalError?(): void

  /** Best-effort post-success hook; failures are swallowed by the listener. */
  afterPersist?(finalMessage: CherryUIMessage): Promise<void>
}
