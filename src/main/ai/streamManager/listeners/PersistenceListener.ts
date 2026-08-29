/**
 * Storage-agnostic terminal-event listener: filters by `modelId`, folds
 * errors into `finalMessage.parts`, carries message-owned runtime stats, and
 * delegates the write to a `PersistenceBackend`.
 */

import { loggerService } from '@logger'
import { serializeError } from '@main/ai/utils/serializeError'
import type {
  CherryMessagePart,
  CherryUIMessage,
  MessageRuntimeStatsInput,
  MessageRuntimeTiming
} from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'

import {
  dropEmptyContentParts,
  finalizeInterruptedParts,
  hasRenderableContent,
  type PersistenceBackend,
  stripTransientStatusParts
} from '../persistence/PersistenceBackend'
import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

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
   * When true, a terminal `success` whose parts carry no renderable content
   * (e.g. a lone `step-start` left by an empty AI SDK stream) is persisted as
   * `error` instead. Defaults to `!backend.canPersistEmptySuccessTerminal` so a
   * backend that declares empty success valid (agents) is not downgraded unless
   * the caller explicitly opts in. The agent runtime's explicit
   * `rejectEmptySuccess: false` is still honoured but no longer required for
   * the backend capability to take effect.
   */
  rejectEmptySuccess?: boolean
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
    return this.persistAssistant(result.finalMessage, 'success', result.runtimeTiming)
  }

  async onPaused(result: StreamPausedResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    return this.persistAssistant(result.finalMessage, 'paused', result.runtimeTiming)
  }

  async onError(result: StreamErrorResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    // Folded once here so backends see a uniform UIMessage shape, not `SerializedError`.
    const withErrorPart = mergeErrorIntoMessage(result.finalMessage, result.error)
    return this.persistAssistant(withErrorPart, 'error', result.runtimeTiming)
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
    runtimeTiming: MessageRuntimeTiming | undefined
  ): Promise<void> {
    // Strip live-only status parts (e.g. data-retry), then empty
    // text/reasoning parts so neither can reach storage. Applied for all
    // statuses. The `finalMessage`
    // guard is for the typed-undefined error path (no finalMessage).
    const strippedParts = finalMessage
      ? dropEmptyContentParts(stripTransientStatusParts(finalMessage.parts as CherryMessagePart[]))
      : undefined

    // Reject "success" streams that ended without any renderable output (e.g. a
    // CherryIN gateway returning an empty stream that only left a `step-start`
    // marker). Persist as a terminal `error` so the turn never renders as an
    // empty success bubble. Check AFTER stripping so empty text/reasoning parts
    // don't count as content. Tool-only turns keep success — tool parts render.
    // `rejectEmptySuccess` defaults to the inverse of the backend capability so
    // a backend that declares empty success valid (agents) is not downgraded
    // unless the caller explicitly opts in. Treat an absent finalMessage as
    // empty parts so a genuinely empty stream is downgraded to error rather than
    // leaving the SQLite placeholder `pending` forever.
    const rejectEmptySuccess = this.opts.rejectEmptySuccess ?? !this.opts.backend.canPersistEmptySuccessTerminal
    const partsForEmptyCheck = strippedParts ?? []
    const shouldDowngradeEmptySuccess =
      status === 'success' && rejectEmptySuccess && !hasRenderableContent(partsForEmptyCheck)
    const effectiveStatus = shouldDowngradeEmptySuccess ? 'error' : status

    const canPersistEmpty =
      effectiveStatus === 'success'
        ? this.opts.backend.canPersistEmptySuccessTerminal
        : this.opts.backend.canPersistEmptyTerminal
    if (!finalMessage && !canPersistEmpty) {
      logger.warn('Terminal event without finalMessage, skipping persistence', {
        backend: this.opts.backend.kind,
        topicId: this.opts.topicId,
        status: effectiveStatus
      })
      return
    }

    const finalMessageForPersistence = finalMessage
      ? {
          ...finalMessage,
          parts: finalizeInterruptedParts(strippedParts as CherryMessagePart[], effectiveStatus)
        }
      : finalMessage
    const contextTokens = finalMessageForPersistence?.metadata?.stats?.contextTokens
    const runtimeStats: MessageRuntimeStatsInput = {
      ...(runtimeTiming ? { runtimeTiming } : {}),
      ...(typeof contextTokens === 'number' && Number.isFinite(contextTokens) ? { contextTokens } : {})
    }

    try {
      await this.opts.backend.persistAssistant({
        finalMessage: finalMessageForPersistence,
        status: effectiveStatus,
        modelId: this.opts.modelId,
        ...(Object.keys(runtimeStats).length > 0 ? { runtimeStats } : {})
      })
      logger.info('Assistant message persisted', {
        backend: this.opts.backend.kind,
        topicId: this.opts.topicId,
        status: effectiveStatus
      })
    } catch (err) {
      logger.error('Failed to persist assistant message', {
        backend: this.opts.backend.kind,
        topicId: this.opts.topicId,
        status: effectiveStatus,
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

    if (effectiveStatus === 'success' && finalMessageForPersistence && this.opts.backend.afterPersist) {
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
function mergeErrorIntoMessage(base: CherryUIMessage | undefined, error: SerializedError): CherryUIMessage {
  const baseParts = (base?.parts ?? []) as CherryMessagePart[]
  const errorPart: CherryMessagePart = { type: 'data-error', data: { ...error } }
  return {
    id: base?.id ?? crypto.randomUUID(),
    role: 'assistant',
    parts: [...baseParts, errorPart],
    ...(base?.metadata ? { metadata: base.metadata } : {})
  } as CherryUIMessage
}
