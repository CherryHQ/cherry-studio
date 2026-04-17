/**
 * Writes an assistant turn to its store when a stream ends.
 *
 * This class is storage-agnostic: it runs the observer-side protocol
 * (filtering by `modelId` so multi-model topics persist per execution,
 * combining partial + error parts, logging) and delegates the actual
 * write to a `PersistenceBackend` strategy.
 *
 * Three built-in backends:
 *  - `MessageServiceBackend`  — persistent (SQLite) chats
 *  - `TemporaryChatBackend`   — temporary (in-memory) chats
 *  - `AgentMessageBackend`    — agent sessions (agents DB)
 */

import { loggerService } from '@logger'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessage } from 'ai'

import type { PersistenceBackend } from '../persistence/PersistenceBackend'
import type { StreamDoneResult, StreamListener, StreamPausedResult } from '../types'

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

  async onError(error: SerializedError, partialMessage?: UIMessage, modelId?: UniqueModelId): Promise<void> {
    if (!this.owns(modelId)) return
    try {
      await this.opts.backend.persistError({ error, partialMessage, modelId })
      logger.info('Assistant error persisted', {
        backend: this.opts.backend.kind,
        topicId: this.opts.topicId,
        hasPartial: !!partialMessage
      })
    } catch (err) {
      logger.error('Failed to persist assistant error', {
        backend: this.opts.backend.kind,
        topicId: this.opts.topicId,
        err
      })
    }
  }

  isAlive(): boolean {
    return true
  }

  private owns(modelId: UniqueModelId | undefined): boolean {
    return !modelId || !this.opts.modelId || modelId === this.opts.modelId
  }

  private async persistAssistant(
    finalMessage: CherryUIMessage | undefined,
    status: 'success' | 'paused'
  ): Promise<void> {
    if (!finalMessage) {
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
    if (status === 'success' && this.opts.backend.afterPersist) {
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
