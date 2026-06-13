import type { UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import type { UIMessageChunk } from 'ai'

import type {
  StreamChunkPayload,
  StreamDonePayload,
  StreamDoneResult,
  StreamErrorPayload,
  StreamErrorResult,
  StreamListener,
  StreamPausedResult
} from '../types'

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

  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId): void {
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }

    const coalescable = toCoalescable(chunk)
    if (coalescable) {
      const next = normalizePending(coalescable, sourceModelId)
      if (
        this.pending &&
        this.pending.type === next.type &&
        this.pending.identifier === next.identifier &&
        this.pending.sourceModelId === next.sourceModelId
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
    this.sendChunk(chunk, sourceModelId)
  }

  onDone(result: StreamDoneResult): void {
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }
    this.flushPending()
    this.wc.send(IpcChannel.Ai_StreamDone, {
      topicId: this.topicId,
      executionId: result.modelId,
      status: result.status,
      isTopicDone: result.isTopicDone
    } satisfies StreamDonePayload)
  }

  onPaused(result: StreamPausedResult): void {
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }
    this.flushPending()
    this.wc.send(IpcChannel.Ai_StreamDone, {
      topicId: this.topicId,
      executionId: result.modelId,
      status: result.status,
      isTopicDone: result.isTopicDone
    } satisfies StreamDonePayload)
  }

  onError(result: StreamErrorResult): void {
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }
    this.flushPending()
    // `result.finalMessage` is not forwarded — the renderer keeps its own accumulated state.
    this.wc.send(IpcChannel.Ai_StreamError, {
      topicId: this.topicId,
      executionId: result.modelId,
      isTopicDone: result.isTopicDone,
      error: result.error
    } satisfies StreamErrorPayload)
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
    this.sendChunk(rebuildChunk(p), p.sourceModelId)
  }

  private discardPending(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pending = null
  }

  private sendChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId): void {
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamChunk, {
      topicId: this.topicId,
      executionId: sourceModelId,
      chunk
    } satisfies StreamChunkPayload)
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

function normalizePending(chunk: CoalescableChunk, sourceModelId: UniqueModelId | undefined): PendingDelta {
  if (chunk.type === 'tool-input-delta') {
    return {
      type: 'tool-input-delta',
      identifier: chunk.toolCallId,
      sourceModelId,
      text: chunk.inputTextDelta
    }
  }
  return {
    type: chunk.type,
    identifier: chunk.id,
    sourceModelId,
    text: chunk.delta
  }
}

function rebuildChunk(p: PendingDelta): UIMessageChunk {
  if (p.type === 'tool-input-delta') {
    return { type: 'tool-input-delta', toolCallId: p.identifier, inputTextDelta: p.text } as UIMessageChunk
  }
  return { type: p.type, id: p.identifier, delta: p.text } as UIMessageChunk
}
