/**
 * Writes an assistant turn to its store when a stream ends.
 *
 * This class is storage-agnostic: it runs the observer-side protocol
 * (filtering by `modelId` so multi-model topics persist per execution,
 * attaching an error part onto the accumulated message, logging) and
 * delegates the actual write to a `PersistenceBackend` strategy.
 *
 * All three terminal callbacks (`onDone` / `onPaused` / `onError`) hand
 * the same `{ finalMessage, status }` shape to the backend — the listener
 * handles the only status-specific detail, which is folding the error
 * into `finalMessage.parts` so backends never see raw `SerializedError`.
 *
 * Semantic timings (first `text-delta`, reasoning boundaries) are also
 * tracked here rather than in `AiStreamManager`. The manager is
 * chunk-shape-agnostic by design; any time metric that requires peeking
 * at `chunk.type` belongs to the listener that cares about it. The
 * manager-side `TransportTimings` (`startedAt` / `completedAt`) arrives
 * on the terminal `result.timings` and gets merged with the listener's
 * `SemanticTimings` before calling `statsFromTerminal`.
 *
 * Three built-in backends:
 *  - `MessageServiceBackend`  — persistent (SQLite) chats
 *  - `TemporaryChatBackend`   — temporary (in-memory) chats
 *  - `AgentMessageBackend`    — agent sessions (agents DB)
 */

import { loggerService } from '@logger'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

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
  /**
   * Model this listener owns. Multi-model topics have one listener per
   * execution; events that don't match this modelId are filtered out.
   * Undefined means "any" — used for single-model contexts.
   */
  modelId?: UniqueModelId
  backend: PersistenceBackend
}

export class PersistenceListener implements StreamListener {
  readonly id: string

  /**
   * AI-SDK-specific chunk-transition timings owned by this listener. The
   * manager deliberately does not track these — keeping chunk-shape
   * knowledge out of the transport layer makes the manager robust to
   * SDK payload changes. One object per listener instance is enough:
   *  - single-model topics have one listener that sees every chunk;
   *  - multi-model topics have one listener per execution (each with a
   *    fixed `opts.modelId`), so each instance only ever sees its own.
   */
  private semanticTimings: SemanticTimings = {}

  constructor(private readonly opts: PersistenceListenerOptions) {
    this.id = `persistence:${opts.backend.kind}:${opts.topicId}:${opts.modelId ?? 'default'}`
  }

  /** Backend strategy tag (e.g. "sqlite", "temp", "agents-db"). */
  get backendKind(): string {
    return this.opts.backend.kind
  }

  /**
   * Observe chunk types to maintain semantic timings. Must stay in sync
   * with the ownership model above — we early-return when a chunk
   * belongs to a different execution than this listener tracks.
   *
   * All three boundaries use set-once semantics:
   *  - `firstTextAt` — first `text-delta` ever seen; doubles as the
   *    end-of-reasoning marker when reasoning was in progress.
   *  - `reasoningStartedAt` — first `reasoning-*` ever seen.
   *  - `reasoningEndedAt` — `firstTextAt` if reasoning preceded text;
   *    otherwise left undefined and `statsFromTerminal` ignores it.
   */
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
    // Fold the error into the accumulated message once, here, so every
    // backend's `persistAssistant` sees a uniform UIMessage shape and
    // never has to synthesise one from raw `SerializedError`.
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

    // Compose stats once (tokens from metadata + transport/semantic
    // timings merged) so every backend writes the same canonical
    // `MessageStats` shape.
    const stats = statsFromTerminal(
      finalMessage,
      transportTimings ? { ...transportTimings, ...this.semanticTimings } : undefined
    )

    try {
      await this.opts.backend.persistAssistant({
        finalMessage,
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
      return
    }

    if (status === 'success' && finalMessage && this.opts.backend.afterPersist) {
      void this.opts.backend.afterPersist(finalMessage).catch((err) => {
        logger.warn('afterPersist hook failed', {
          backend: this.opts.backend.kind,
          topicId: this.opts.topicId,
          err
        })
      })
    }
  }
}

/**
 * Fold a `SerializedError` into the accumulated `finalMessage` as a
 * trailing `data-error` part. Returns a synthetic message when the
 * stream errored before producing any chunks.
 */
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
