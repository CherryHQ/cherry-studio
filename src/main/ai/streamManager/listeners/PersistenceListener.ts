/**
 * Storage-agnostic terminal-event listener: filters by `modelId`, folds
 * errors into `finalMessage.parts`, carries message-owned runtime stats, and
 * delegates the write to a `PersistenceBackend`.
 */

import type { ExecutionFailure } from '@cherrystudio/remote-protocol/failure'
import { loggerService } from '@logger'
import { serializeError } from '@main/ai/utils/serializeError'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import { terminalSentinel } from '@shared/ai/terminalSentinel'
import type {
  CherryMessagePart,
  CherryUIMessage,
  MessageRuntimeStatsInput,
  MessageRuntimeTiming
} from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { hasTurnContent, isRenderedContentPart } from '@shared/data/types/terminalContent'
import type { SerializedError } from '@shared/types/error'

import {
  dropEmptyContentParts,
  finalizeInterruptedParts,
  type PersistenceBackend,
  stripTransientStatusParts
} from '../persistence/PersistenceBackend'
import type { EmptyTurnReason, StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('PersistenceListener')

/** Internal control signal: the persistence failure was already surfaced as an error event. */
export class TerminalPersistenceError extends Error {}

export interface PersistenceListenerOptions {
  /** Listener id namespace — typically the topic id. */
  topicId: string
  /** Multi-model: one listener per execution, filter by modelId. Undefined = single-model "any". */
  modelId?: UniqueModelId
  backend: PersistenceBackend
  /**
   * Called when persistence fails after a terminal event. The DB row is already driven to
   * `error`; this lets the caller surface that error while the manager suppresses the original
   * terminal notification.
   */
  onPersistFailed: (error: SerializedError) => void
}

export class PersistenceListener implements StreamListener {
  readonly id: string
  readonly terminalPhase = 'persistence' as const

  constructor(private readonly opts: PersistenceListenerOptions) {
    this.id = `persistence:${opts.backend.kind}:${opts.topicId}:${opts.modelId ?? 'default'}`
  }

  /** Backend strategy tag (e.g. "sqlite", "temp", "agents-db"). */
  get backendKind(): string {
    return this.opts.backend.kind
  }

  onChunk(): void {
    // Message timing is captured by the runtime collector, not inferred from chunks here.
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    // A turn that settled clean but produced nothing is a failure, not an empty
    // answer: the provider was paid and the user was given no reply. Classify it
    // before it lands as a contentless `success` row.
    const emptyTurn = diagnoseEmptySuccessTurn(result.finalMessage)
    if (emptyTurn) {
      result.finalMessage = classifyEmptyTurn(
        result.finalMessage,
        emptyTurn,
        this.opts.modelId,
        result.anchorMessageId ?? this.opts.backend.assistantMessageId
      )
      result.emptyTurn = emptyTurn
    }
    return this.persistAssistant(result.finalMessage, 'success', result.runtimeTiming, result)
  }

  async onPaused(result: StreamPausedResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    return this.persistAssistant(result.finalMessage, 'paused', result.runtimeTiming, result)
  }

  async onError(result: StreamErrorResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    // Folded once here so backends see a uniform UIMessage shape, not `SerializedError`.
    result.failure ??= toExecutionFailure(result.error, result.modelId)
    const withErrorPart = mergeErrorIntoMessage(
      result.finalMessage,
      result.error,
      result.failure,
      result.anchorMessageId
    )
    return this.persistAssistant(withErrorPart, 'error', result.runtimeTiming, result)
  }

  isAlive(): boolean {
    return true
  }

  private owns(modelId: UniqueModelId | undefined): boolean {
    return !modelId || !this.opts.modelId || modelId === this.opts.modelId
  }

  private async persistAssistant(
    finalMessage: CherryUIMessage | undefined,
    status: 'success' | 'paused' | 'error',
    runtimeTiming: MessageRuntimeTiming | undefined,
    result: StreamDoneResult | StreamPausedResult | StreamErrorResult
  ): Promise<void> {
    // `onDone` classifies before persisting, so a successful turn always carries
    // a finalMessage here; only paused/error can legitimately arrive without one.
    const canPersistEmpty = this.opts.backend.canPersistEmptyTerminal
    if (!finalMessage && !canPersistEmpty) {
      logger.warn('Terminal event without finalMessage, skipping persistence', {
        backend: this.opts.backend.kind,
        topicId: this.opts.topicId,
        status
      })
      return
    }

    // Strip live-only status parts (e.g. data-retry), then empty
    // text/reasoning parts so neither can reach storage. Applied for all
    // statuses. The `finalMessage`
    // guard is for the typed-undefined error path (no finalMessage).
    const finalMessageForPersistence = finalMessage
      ? {
          ...finalMessage,
          parts: finalizeInterruptedParts(dropEmptyContentParts(stripTransientStatusParts(finalMessage.parts)), status)
        }
      : finalMessage
    const contextTokens = finalMessageForPersistence?.metadata?.stats?.contextTokens
    const runtimeStats: MessageRuntimeStatsInput = {
      ...(runtimeTiming ? { runtimeTiming } : {}),
      ...(typeof contextTokens === 'number' && Number.isFinite(contextTokens) ? { contextTokens } : {})
    }

    try {
      const saved = await this.opts.backend.persistAssistant({
        finalMessage: finalMessageForPersistence,
        status,
        modelId: this.opts.modelId,
        ...(Object.keys(runtimeStats).length > 0 ? { runtimeStats } : {})
      })
      if (saved) result.persistence = { status: 'saved', message: saved }
      logger.info('Assistant message persisted', {
        backend: this.opts.backend.kind,
        topicId: this.opts.topicId,
        status
      })
    } catch (err) {
      result.persistence = {
        status: 'failed',
        failure: toExecutionFailure(serializeError(err), this.opts.modelId, 'host')
      }
      logger.error('Failed to persist assistant message', {
        backend: this.opts.backend.kind,
        topicId: this.opts.topicId,
        status,
        err
      })
      // The placeholder row stays `pending` forever (boot-time reconcile aside), so on reload it
      // shows a frozen loading bubble. Best-effort drive it to a terminal `error` state instead.
      try {
        this.opts.backend.markTerminalError?.()
      } catch (markErr) {
        logger.error('Failed to mark assistant message as terminal error after persist failure', {
          backend: this.opts.backend.kind,
          topicId: this.opts.topicId,
          status,
          err: markErr
        })
      }
      // Surface the persistence error now; the manager suppresses the original terminal notification.
      try {
        this.opts.onPersistFailed(serializeError(err))
      } catch (notifyErr) {
        logger.error('Failed to surface terminal persistence error', {
          backend: this.opts.backend.kind,
          topicId: this.opts.topicId,
          status,
          err: notifyErr
        })
      }
      throw new TerminalPersistenceError('Terminal persistence failed after attempting to surface the error')
    }

    if (status === 'success' && finalMessageForPersistence && this.opts.backend.afterPersist) {
      void this.opts.backend.afterPersist(finalMessageForPersistence).catch((err) => {
        logger.warn('afterPersist hook failed', {
          backend: this.opts.backend.kind,
          topicId: this.opts.topicId,
          err
        })
      })
    }
  }
}

/** Returns a synthetic message when the stream errored before producing chunks. */
function mergeErrorIntoMessage(
  base: CherryUIMessage | undefined,
  error: SerializedError,
  failure: ExecutionFailure,
  anchorMessageId?: string
): CherryUIMessage {
  const baseParts = (base?.parts ?? []) as CherryMessagePart[]
  const errorPart: CherryMessagePart = { type: 'data-error', data: { ...error, executionFailure: failure } }
  return {
    id: base?.id ?? anchorMessageId ?? crypto.randomUUID(),
    role: 'assistant',
    parts: [...baseParts, errorPart],
    ...(base?.metadata ? { metadata: base.metadata } : {})
  }
}

/**
 * Detect the "successful turn with no answer" defect (P2): the turn reached us via
 * `onDone`, so the stream ended cleanly, but nothing renderable was produced —
 * often while usage reports real token spend, proving the model did work whose
 * result never reached the user.
 *
 * Only unconditional empty success is diagnosed here. A turn with no parts at all
 * is the content-discarded case. A turn whose only content is an error part is a
 * delivery/status artifact of a *previous* turn and is left alone. Turns the user
 * stopped (`paused`) never reach this path.
 */
export function diagnoseEmptySuccessTurn(finalMessage: CherryUIMessage | undefined): EmptyTurnReason | undefined {
  if (!finalMessage) {
    return {
      name: 'no-parts',
      detail: 'The model finished the request without producing a reply.'
    }
  }
  const parts = (finalMessage.parts ?? []) as CherryMessagePart[]
  if (parts.length === 0) {
    return {
      name: 'no-parts',
      detail: 'The model finished the request without producing a reply.'
    }
  }
  if (hasTurnContent(parts)) {
    // `hasTurnContent` only looks at part types, so whitespace-only text/reasoning
    // counts as content here — but `dropEmptyContentParts` strips those before
    // storage, which would land another silent empty success. A turn still counts
    // as answered when any content part survives the blank check: tool parts carry
    // their answer in `output`, not `text`, so the check must ignore them rather
    // than read their missing `text` as blank.
    const blankTextContent = parts.filter(
      (part): part is CherryMessagePart & { text: string } =>
        (part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string'
    )
    if (blankTextContent.some((part) => part.text.trim().length > 0)) return undefined
    if (parts.some((part) => part.type !== 'text' && part.type !== 'reasoning' && isRenderedContentPart(part))) {
      return undefined
    }
  }
  const hasErrorPart = parts.some((part) => part.type === 'data-error')
  if (hasErrorPart) return undefined
  // A `/compact` turn legitimately ends with no answer: the compaction record IS
  // the outcome. Treating it as a lost reply would mislabel every compacted turn.
  const isCompactionTurn = parts.some((part) => part.type === 'data-compaction-anchor')
  if (isCompactionTurn) return undefined
  return {
    name: 'blank-content',
    detail: 'The model finished the request without producing a reply.'
  }
}

/**
 * Rewrite a contentless successful turn so it carries a classified `data-error`.
 *
 * Returns a new message rather than mutating: the accumulated snapshot is shared
 * with every other listener on the turn, and rewriting it in place would make the
 * error visible to readers that already rendered the (empty) answer.
 */
export function classifyEmptyTurn(
  finalMessage: CherryUIMessage | undefined,
  reason: EmptyTurnReason,
  modelId?: UniqueModelId,
  anchorMessageId?: string
): CherryUIMessage {
  const error = terminalSentinel('turn.no_content', { detail: reason.detail })
  const failure = toExecutionFailure(error, modelId, 'runtime')
  const errorPart: CherryMessagePart = { type: 'data-error', data: { ...error, executionFailure: failure } }
  const baseParts = (finalMessage?.parts ?? []) as CherryMessagePart[]
  // Fall back to the anchor so the classified error finalizes the *existing*
  // placeholder row. A fresh id would create a second row and strand the
  // placeholder as `pending` forever.
  return {
    id: finalMessage?.id ?? anchorMessageId ?? crypto.randomUUID(),
    role: 'assistant',
    parts: [...baseParts, errorPart],
    ...(finalMessage?.metadata ? { metadata: finalMessage.metadata } : {})
  }
}
