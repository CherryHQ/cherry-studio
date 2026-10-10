/**
 * Storage-agnostic terminal-event listener: filters by `modelId`, folds
 * errors into `finalMessage.parts`, carries message-owned runtime stats, and
 * delegates the write to a `PersistenceBackend`.
 */

import type { ExecutionFailure } from '@cherrystudio/remote-protocol/failure'
import { loggerService } from '@logger'
import { serializeError } from '@main/ai/utils/serializeError'
import { toExecutionFailure } from '@shared/ai/executionFailure'
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
  hasNoAnswerContent,
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
    const canPersistEmpty =
      status === 'success'
        ? this.opts.backend.canPersistEmptySuccessTerminal
        : this.opts.backend.canPersistEmptyTerminal
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

    // A billed zero-text turn: the stream ended cleanly and usage reported
    // output tokens, yet no answer content was streamed (e.g. an upstream
    // completion cap truncating the reply below the configured
    // maxOutputTokens — issue #21315). Persisting it as `success` shows the
    // user a silent empty bubble; demote it through the existing error path
    // so the failure is surfaced with a retry affordance. Backends that
    // accept an empty success (agent sessions) keep their semantics.
    if (
      status === 'success' &&
      finalMessageForPersistence &&
      !this.opts.backend.canPersistEmptySuccessTerminal &&
      finalMessageForPersistence.metadata?.stats?.outputTokens !== undefined &&
      finalMessageForPersistence.metadata.stats.outputTokens > 0 &&
      hasNoAnswerContent(finalMessageForPersistence.parts)
    ) {
      const error = zeroTextTurnError(finalMessageForPersistence.metadata.stats.outputTokens)
      // Explicit app-owned failure metadata. The prose carries the billed token count, and letting
      // toExecutionFailure re-parse it (extractHttpStatus) would reclassify e.g. 401 tokens as a
      // persisted, non-retryable auth failure instead of the retryable runtime gap this is.
      const failure: ExecutionFailure = {
        message: error.message ?? '',
        retryable: true,
        failure: {
          version: 1,
          reasonCode: 'internal',
          source: { layer: 'runtime', name: 'EmptyResponseError' },
          ...(this.opts.modelId
            ? { context: { providerId: this.opts.modelId.split('::')[0], modelId: this.opts.modelId } }
            : {})
        }
      }
      const withErrorPart = mergeErrorIntoMessage(finalMessageForPersistence, error, failure, result.anchorMessageId)
      return this.persistAssistant(withErrorPart, 'error', runtimeTiming, result)
    }

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

/** Synthetic error for a turn the provider billed but streamed no answer content into. */
function zeroTextTurnError(outputTokens: number): SerializedError {
  return {
    name: 'EmptyResponseError',
    message: `The provider reported ${outputTokens} output tokens but the reply arrived without any content — it was likely truncated upstream. Retry the request.`,
    stack: null,
    isRetryable: true
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
