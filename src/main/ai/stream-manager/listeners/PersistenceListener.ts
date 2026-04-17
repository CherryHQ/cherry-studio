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
 * Three built-in backends:
 *  - `MessageServiceBackend`  — persistent (SQLite) chats
 *  - `TemporaryChatBackend`   — temporary (in-memory) chats
 *  - `AgentMessageBackend`    — agent sessions (agents DB)
 */

import { loggerService } from '@logger'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'

import type { PersistenceBackend } from '../persistence/PersistenceBackend'
import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

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

  constructor(private readonly opts: PersistenceListenerOptions) {
    this.id = `persistence:${opts.backend.kind}:${opts.topicId}:${opts.modelId ?? 'default'}`
  }

  /** Backend strategy tag (e.g. "sqlite", "temp", "agents-db"). */
  get backendKind(): string {
    return this.opts.backend.kind
  }

  onChunk(): void {
    // Persistence only writes on terminal events.
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    await this.persistAssistant(result.finalMessage, 'success')
  }

  async onPaused(result: StreamPausedResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    await this.persistAssistant(result.finalMessage, 'paused')
  }

  async onError(result: StreamErrorResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    // Fold the error into the accumulated message once, here, so every
    // backend's `persistAssistant` sees a uniform UIMessage shape and
    // never has to synthesise one from raw `SerializedError`.
    const withErrorPart = mergeErrorIntoMessage(result.finalMessage, result.error)
    await this.persistAssistant(withErrorPart, 'error')
  }

  isAlive(): boolean {
    return true
  }

  private owns(modelId: UniqueModelId | undefined): boolean {
    return !modelId || !this.opts.modelId || modelId === this.opts.modelId
  }

  private async persistAssistant(
    finalMessage: CherryUIMessage | undefined,
    status: 'success' | 'paused' | 'error'
  ): Promise<void> {
    if (!finalMessage && status !== 'error') {
      logger.warn('Terminal event without finalMessage, skipping persistence', {
        backend: this.opts.backend.kind,
        topicId: this.opts.topicId,
        status
      })
      return
    }

    try {
      await this.opts.backend.persistAssistant({
        finalMessage,
        status,
        modelId: this.opts.modelId
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

    // Post-persist hook is best-effort — failures never propagate.
    if (status === 'success' && finalMessage && this.opts.backend.afterPersist) {
      try {
        await this.opts.backend.afterPersist(finalMessage)
      } catch (err) {
        logger.warn('afterPersist hook failed', {
          backend: this.opts.backend.kind,
          topicId: this.opts.topicId,
          err
        })
      }
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
