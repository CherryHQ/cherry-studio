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
  type PersistenceBackend
} from '../persistence/PersistenceBackend'
import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('PersistenceListener')

export interface PersistenceListenerOptions {
  /** Listener id namespace — typically the topic id. */
  topicId: string
  /** Multi-model: one listener per execution, filter by modelId. Undefined = single-model "any". */
  modelId?: UniqueModelId
  backend: PersistenceBackend
  /**
   * When true (default), a terminal `success` whose parts carry no renderable
   * content (e.g. a lone `step-start` left by an empty AI SDK stream) is
   * persisted as `error` instead. Set to false when the caller deliberately
   * supplies terminal status — e.g. the agent runtime, whose empty-parts
   * successes are legitimate and already handled by the agents renderer's own
   * empty-terminal fallback.
   */
  rejectEmptySuccess?: boolean
  /**
   * Called when persistence fails after a terminal event. The DB row is already driven to
   * `error`; this lets the caller also correct the LIVE renderer (which was told the turn
   * succeeded) so the bubble doesn't stay a frozen success until reload.
   */
  onPersistFailed?: (error: SerializedError) => void
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
    // Message timing is captured by the runtime collector, not inferred from chunks here.
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    await this.persistAssistant(result.finalMessage, 'success', result.runtimeTiming)
  }

  async onPaused(result: StreamPausedResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    await this.persistAssistant(result.finalMessage, 'paused', result.runtimeTiming)
  }

  async onError(result: StreamErrorResult): Promise<void> {
    if (!this.owns(result.modelId)) return
    // Folded once here so backends see a uniform UIMessage shape, not `SerializedError`.
    const withErrorPart = mergeErrorIntoMessage(result.finalMessage, result.error)
    await this.persistAssistant(withErrorPart, 'error', result.runtimeTiming)
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
    if (!finalMessage && (status === 'success' || !this.opts.backend.canPersistEmptyTerminal)) {
      logger.warn('Terminal event without finalMessage, skipping persistence', {
        backend: this.opts.backend.kind,
        topicId: this.opts.topicId,
        status
      })
      return
    }

    // Strip empty text/reasoning parts so invisible (zero-height) message blocks
    // are never written to storage. Applied for all statuses. The `finalMessage`
    // guard is for the typed-undefined error path (no finalMessage).
    const strippedParts = finalMessage ? dropEmptyContentParts(finalMessage.parts as CherryMessagePart[]) : undefined

    // Reject "success" streams that ended without any renderable output (e.g. a
    // CherryIN gateway returning an empty stream that only left a `step-start`
    // marker). Persist as a terminal `error` so the turn never renders as an
    // empty success bubble. Check AFTER stripping so empty text/reasoning parts
    // don't count as content. Tool-only turns keep success — tool parts render.
    // Opted out (via `rejectEmptySuccess: false`) by callers that deliberately
    // supply terminal status, e.g. the agent-session runtime.
    const rejectEmptySuccess = this.opts.rejectEmptySuccess ?? true
    const effectiveStatus =
      status === 'success' && rejectEmptySuccess && strippedParts !== undefined && !hasRenderableContent(strippedParts)
        ? 'error'
        : status

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
      // Correct the live renderer: it was already told this turn succeeded.
      this.opts.onPersistFailed?.(serializeError(err))
      return
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
