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

/**
 * Pushes stream events to an Electron WebContents (= one Renderer window).
 *
 * Routing is done upstream by AiStreamManager (isMultiModel → sourceModelId
 * tag) and downstream by the frontend transport (matchesStream). One
 * instance per topic per window.
 *
 * ID: `wc:${wc.id}:${topicId}` — stable across re-attach so `addListener`
 * upserts rather than registering a duplicate.
 */
export class WebContentsListener implements StreamListener {
  readonly id: string

  private pending: PendingDelta | null = null
  private flushTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly wc: Electron.WebContents,
    private readonly topicId: string
  ) {
    this.id = `wc:${wc.id}:${topicId}`
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
        return
      }
      this.flushPending()
      this.pending = next
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
      isTopicDone: result.isTopicDone,
      finalMessage: result.finalMessage
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
      isTopicDone: result.isTopicDone,
      finalMessage: result.finalMessage
    } satisfies StreamDonePayload)
  }

  onError(result: StreamErrorResult): void {
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }
    this.flushPending()
    // We don't forward `result.finalMessage` here yet — the renderer keeps
    // its own accumulated state from the chunk stream. Plumbing partial
    // content through the IPC payload is a future optimisation.
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
