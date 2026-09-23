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
    const contextTokens = finalMessageForPersistence?.metadata?.stats?.contextTokens
    const runtimeStats: MessageRuntimeStatsInput = {
      ...(runtimeTiming ? { runtimeTiming } : {}),
      ...(typeof contextTokens === 'number' && Number.isFinite(contextTokens) ? { contextTokens } : {})
    }

    try {
      await this.opts.backend.persistAssistant({
        finalMessage: finalMessageForPersistence,
        status,
        modelId: this.opts.modelId,
        ...(Object.keys(runtimeStats).length > 0 ? { runtimeStats } : {})
      })
      logger.info('Assistant message persisted', {
        backend: this.opts.backend.kind,
        topicId: this.opts.topicId,
        status
      })
    } catch (err) {
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
function mergeErrorIntoMessage(base: CherryUIMessage | undefined, error: SerializedError): CherryUIMessage {
  const baseParts = (base?.parts ?? []) as CherryMessagePart[]
  const errorPart: CherryMessagePart = { type: 'data-error', data: { ...error } }
  return {
    id: base?.id ?? crypto.randomUUID(),
    role: 'assistant',
    parts: [...baseParts, errorPart],
    ...(base?.metadata ? { metadata: base.metadata } : {})
  }
}
