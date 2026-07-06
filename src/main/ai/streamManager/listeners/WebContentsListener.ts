import type { UniqueModelId } from '@shared/data/types/model'
import type { IpcEventName } from '@shared/ipc/schemas/ipcSchemas'
import type { EventPayload } from '@shared/ipc/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { UIMessageChunk } from 'ai'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

const COALESCE_WINDOW_MS = 16
const MAX_COALESCE_AGE_MS = 16
const MAX_COALESCE_CHARS = 2048

/** Id prefix for renderer (WebContents) listeners — full form `wc:${wc.id}:${topicId}`. */
const RENDERER_LISTENER_ID_PREFIX = 'wc:'

/**
 * True if `listener` streams to a renderer window (as opposed to an internal persistence / trace /
 * channel listener). Carried-forward filtering (e.g. a steer continuation re-attaching the prior
 * turn's windows) keys off this — using the predicate instead of an inline `'wc:'` literal keeps it
 * in lockstep with the id format, so a future id-format change can't silently stop windows
 * re-attaching to a continuation.
 */
export function isRendererListener(listener: Pick<StreamListener, 'id'>): boolean {
  return listener.id.startsWith(RENDERER_LISTENER_ID_PREFIX)
}

interface PendingDelta {
  type: 'text-delta' | 'reasoning-delta' | 'tool-input-delta'
  identifier: string
  sourceModelId: UniqueModelId | undefined
  anchorMessageId: string | undefined
  text: string
}

type CoalescableChunk =
  | { type: 'text-delta'; id: string; delta: string; providerMetadata?: undefined }
  | { type: 'reasoning-delta'; id: string; delta: string; providerMetadata?: undefined }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }

/** One instance per (topic, window). Id `wc:${wc.id}:${topicId}` is stable across re-attach. */
export class WebContentsListener implements StreamListener {
  readonly id: string

  private pending: PendingDelta | null = null
  private pendingStartedAt = 0
  private flushTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly wc: Electron.WebContents,
    private readonly topicId: string
  ) {
    this.id = `${RENDERER_LISTENER_ID_PREFIX}${wc.id}:${topicId}`
    // Clear the coalesce timer if the window dies between chunks — without
    // this hook a quiet stream end leaks the timer.
    this.wc.once('destroyed', () => this.discardPending())
  }

  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId, anchorMessageId?: string): void {
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }

    const coalescable = toCoalescable(chunk)
    if (coalescable) {
      const next = normalizePending(coalescable, sourceModelId, anchorMessageId)
      if (
        this.pending &&
        this.pending.type === next.type &&
        this.pending.identifier === next.identifier &&
        this.pending.sourceModelId === next.sourceModelId &&
        this.pending.anchorMessageId === next.anchorMessageId
      ) {
        this.pending.text += next.text
        if (
          performance.now() - this.pendingStartedAt >= MAX_COALESCE_AGE_MS ||
          this.pending.text.length >= MAX_COALESCE_CHARS
        ) {
          this.flushPending()
        }
        return
      }
      this.flushPending()
      this.pending = next
      this.pendingStartedAt = performance.now()
      this.flushTimer = setTimeout(() => this.flushPending(), COALESCE_WINDOW_MS)
      return
    }

    this.flushPending()
    this.sendChunk(chunk, sourceModelId, anchorMessageId)
  }

  onDone(result: StreamDoneResult): void {
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }
    this.flushPending()
    this.emit('ai.stream_done', {
      topicId: this.topicId,
      executionId: result.modelId,
      anchorMessageId: result.anchorMessageId,
      status: result.status,
      isTopicDone: result.isTopicDone
    })
  }

  onPaused(result: StreamPausedResult): void {
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }
    this.flushPending()
    this.emit('ai.stream_done', {
      topicId: this.topicId,
      executionId: result.modelId,
      anchorMessageId: result.anchorMessageId,
      status: result.status,
      isTopicDone: result.isTopicDone
    })
  }

  onError(result: StreamErrorResult): void {
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }
    this.flushPending()
    // `result.finalMessage` is not forwarded — the renderer keeps its own accumulated state.
    this.emit('ai.stream_error', {
      topicId: this.topicId,
      executionId: result.modelId,
      anchorMessageId: result.anchorMessageId,
      isTopicDone: result.isTopicDone,
      error: result.error
    })
  }

  isAlive(): boolean {
    const alive = !this.wc.isDestroyed()
    if (!alive) this.discardPending()
    return alive
  }

  private flushPending(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    const p = this.pending
    if (!p) return
    this.pending = null
    this.sendChunk(rebuildChunk(p), p.sourceModelId, p.anchorMessageId)
  }

  private discardPending(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pending = null
  }

  private sendChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId, anchorMessageId?: string): void {
    if (this.wc.isDestroyed()) return
    this.emit('ai.stream_chunk', {
      topicId: this.topicId,
      executionId: sourceModelId,
      anchorMessageId,
      chunk
    })
  }

  /**
   * Directed send of a typed AI stream event on the single IpcApi event channel — the
   * class-B topic-stream transport: this per-(topic,window) listener `send`s straight to its
   * own `WebContents` (preserving the coalescing/liveness above) instead of `broadcast`ing.
   * Wire-identical to `IpcApiService.send`, but keyed by the held `WebContents`, not a WindowId.
   */
  private emit<E extends IpcEventName>(event: E, payload: EventPayload<E>): void {
    this.wc.send(IpcChannel.IpcApi_Event, event, payload)
  }
}

function toCoalescable(chunk: UIMessageChunk): CoalescableChunk | null {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
    if ('providerMetadata' in chunk && chunk.providerMetadata !== undefined) return null
    return chunk as CoalescableChunk
  }
  if (chunk.type === 'tool-input-delta') {
    return chunk as CoalescableChunk
  }
  return null
}

function normalizePending(
  chunk: CoalescableChunk,
  sourceModelId: UniqueModelId | undefined,
  anchorMessageId: string | undefined
): PendingDelta {
  if (chunk.type === 'tool-input-delta') {
    return {
      type: 'tool-input-delta',
      identifier: chunk.toolCallId,
      sourceModelId,
      anchorMessageId,
      text: chunk.inputTextDelta
    }
  }
  return {
    type: chunk.type,
    identifier: chunk.id,
    sourceModelId,
    anchorMessageId,
    text: chunk.delta
  }
}

function rebuildChunk(p: PendingDelta): UIMessageChunk {
  if (p.type === 'tool-input-delta') {
    return { type: 'tool-input-delta', toolCallId: p.identifier, inputTextDelta: p.text } as UIMessageChunk
  }
  return { type: p.type, id: p.identifier, delta: p.text } as UIMessageChunk
}
