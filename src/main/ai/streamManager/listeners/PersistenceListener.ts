/**
 * Storage-agnostic terminal-event listener: filters by `modelId`, folds
 * errors into `finalMessage.parts`, tracks semantic timings (chunk-shape
 * knowledge stays out of the manager), composes `MessageStats`, delegates
 * the write to a `PersistenceBackend`.
 */

import { loggerService } from '@logger'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { type SerializedError, serializeError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import { normalizeAssistantMessageCitations } from '../persistence/normalizeCitations'
import { type PersistenceBackend, statsFromTerminal } from '../persistence/PersistenceBackend'
import type {
  SemanticTimings,
  StreamDoneResult,
  StreamErrorResult,
  StreamListener,
  StreamPausedResult,
  TransportTimings
} from '../types'

const logger = loggerService.withContext('PersistenceListener')

export interface PersistenceListenerOptions {
  /** Listener id namespace — typically the topic id. */
  topicId: string
  /** Multi-model: one listener per execution, filter by modelId. Undefined = single-model "any". */
  modelId?: UniqueModelId
  backend: PersistenceBackend
  /**
   * Called when persistence fails after a terminal event. The DB row is already driven to
   * `error`; this lets the caller also correct the LIVE renderer (which was told the turn
   * succeeded) so the bubble doesn't stay a frozen success until reload.
   */
  onPersistFailed?: (error: SerializedError) => void
}

export class PersistenceListener implements StreamListener {
  readonly id: string

  private semanticTimings: SemanticTimings = {}

  constructor(private readonly opts: PersistenceListenerOptions) {
    this.id = `persistence:${opts.backend.kind}:${opts.topicId}:${opts.modelId ?? 'default'}`
  }

  /** Backend strategy tag (e.g. "sqlite", "temp", "agents-db"). */
  get backendKind(): string {
    return this.opts.backend.kind
  }

  /** Set-once timings. `reasoningEndedAt` = `firstTextAt` when reasoning preceded text; else undefined. */
  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId): void {
    if (!this.owns(sourceModelId)) return

    if (chunk.type === 'text-delta') {
      if (this.semanticTimings.firstTextAt == null) {
        this.semanticTimings.firstTextAt = performance.now()
      }
      if (this.semanticTimings.reasoningStartedAt != null && this.semanticTimings.reasoningEndedAt == null) {
        this.semanticTimings.reasoningEndedAt = this.semanticTimings.firstTextAt
      }
    } else if (
      this.semanticTimings.reasoningStartedAt == null &&
      (chunk.type === 'reasoning-start' || chunk.type === 'reasoning-delta')
    ) {
      this.semanticTimings.reasoningStartedAt = performance.now()
    }
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    await this.persistAssistant(result.finalMessage, 'success', result.timings)
  }

  async onPaused(result: StreamPausedResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    await this.persistAssistant(result.finalMessage, 'paused', result.timings)
  }

  async onError(result: StreamErrorResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    // Folded once here so backends see a uniform UIMessage shape, not `SerializedError`.
    const withErrorPart = mergeErrorIntoMessage(result.finalMessage, result.error)
    await this.persistAssistant(withErrorPart, 'error', result.timings)
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
    transportTimings: TransportTimings | undefined
  ): Promise<void> {
    if (!finalMessage && status !== 'error') {
      logger.warn('Terminal event without finalMessage, skipping persistence', {
        backend: this.opts.backend.kind,
        topicId: this.opts.topicId,
        status
      })
      return
    }

    const finalMessageForPersistence =
      status === 'success' && finalMessage ? normalizeAssistantMessageCitations(finalMessage) : finalMessage

    const stats = statsFromTerminal(
      finalMessageForPersistence,
      transportTimings ? { ...transportTimings, ...this.semanticTimings } : undefined
    )

    try {
      await this.opts.backend.persistAssistant({
        finalMessage: finalMessageForPersistence,
        status,
        modelId: this.opts.modelId,
        stats
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
        await this.opts.backend.markTerminalError?.()
      } catch (markErr) {
        logger.error('Failed to mark assistant message as terminal error after persist failure', {
          backend: this.opts.backend.kind,
          topicId: this.opts.topicId,
          status,
          err: markErr
        })
      }
      // Correct the live renderer: it was already told this turn succeeded.
      this.opts.onPersistFailed?.(serializeError(err))
      return
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
  } as CherryUIMessage
}
