import { projectStreamChunkForRenderer } from '@main/utils/messageOutputProjection'
import { type ConversationRef, conversationRefKey, ConversationStreamTerminalStatus } from '@shared/ai/conversation'
import type { IpcEventName } from '@shared/ipc/schemas/ipcSchemas'
import type { EventPayload } from '@shared/ipc/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { UIMessageChunk } from 'ai'

import type {
  ConversationStreamIdentity,
  StreamDoneResult,
  StreamErrorResult,
  StreamListener,
  StreamPausedResult
} from '../types'

const COALESCE_WINDOW_MS = 16
const MAX_COALESCE_AGE_MS = 16
const MAX_COALESCE_CHARS = 2048

const RENDERER_LISTENER_ID_PREFIX = 'wc:'

interface PendingDelta {
  type: 'text-delta' | 'reasoning-delta' | 'tool-input-delta'
  identifier: string
  identity: ConversationStreamIdentity
  text: string
}

type CoalescableChunk =
  | { type: 'text-delta'; id: string; delta: string; providerMetadata?: undefined }
  | { type: 'reasoning-delta'; id: string; delta: string; providerMetadata?: undefined }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }

/** One instance per (Conversation, window). */
export class WebContentsListener implements StreamListener {
  readonly id: string

  private pending: PendingDelta | null = null
  private pendingStartedAt = 0
  private flushTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly wc: Electron.WebContents,
    private readonly conversation: ConversationRef
  ) {
    this.id = `${RENDERER_LISTENER_ID_PREFIX}${wc.id}:${conversationRefKey(conversation)}`
  }

  onChunk(chunk: UIMessageChunk, identity?: ConversationStreamIdentity): void {
    if (!identity) return
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }

    const coalescable = toCoalescable(chunk)
    if (coalescable) {
      const next = normalizePending(coalescable, identity)
      if (
        this.pending &&
        this.pending.type === next.type &&
        this.pending.identifier === next.identifier &&
        this.pending.identity.turnId === next.identity.turnId &&
        this.pending.identity.executionId === next.identity.executionId &&
        this.pending.identity.modelId === next.identity.modelId &&
        this.pending.identity.outputNodeId === next.identity.outputNodeId
      ) {
        this.pending.text += next.text
        this.pending.identity = {
          ...next.identity,
          chunkSeq: this.pending.identity.chunkSeq
        }
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
    this.sendChunk(chunk, identity)
  }

  onDone(result: StreamDoneResult): void {
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }
    this.flushPending()
    if (!result.turnId || !result.executionId || !result.modelId || !result.anchorMessageId) return
    this.emit('ai.stream.done', {
      conversation: this.conversation,
      turnId: result.turnId,
      executionId: result.executionId,
      modelId: result.modelId,
      outputNodeId: result.anchorMessageId,
      status: ConversationStreamTerminalStatus.Done,
      turnTerminal: result.turnTerminal === true
    })
  }

  onPaused(result: StreamPausedResult): void {
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }
    this.flushPending()
    if (!result.turnId || !result.executionId || !result.modelId || !result.anchorMessageId) return
    this.emit('ai.stream.done', {
      conversation: this.conversation,
      turnId: result.turnId,
      executionId: result.executionId,
      modelId: result.modelId,
      outputNodeId: result.anchorMessageId,
      status: ConversationStreamTerminalStatus.Paused,
      turnTerminal: result.turnTerminal === true
    })
  }

  onError(result: StreamErrorResult): void {
    if (this.wc.isDestroyed()) {
      this.discardPending()
      return
    }
    this.flushPending()
    // `result.finalMessage` is not forwarded — the renderer keeps its own accumulated state.
    if (!result.turnId || !result.executionId || !result.modelId || !result.anchorMessageId) return
    this.emit('ai.stream.error', {
      conversation: this.conversation,
      turnId: result.turnId,
      executionId: result.executionId,
      modelId: result.modelId,
      outputNodeId: result.anchorMessageId,
      turnTerminal: result.turnTerminal === true,
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
    this.sendChunk(rebuildChunk(p), p.identity)
  }

  private discardPending(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pending = null
  }

  private sendChunk(chunk: UIMessageChunk, identity: ConversationStreamIdentity): void {
    if (this.wc.isDestroyed()) return
    const projectedChunk = projectStreamChunkForRenderer(chunk, this.conversation, identity.outputNodeId)
    this.emit('ai.stream.chunk', {
      conversation: this.conversation,
      turnId: identity.turnId,
      executionId: identity.executionId,
      modelId: identity.modelId,
      outputNodeId: identity.outputNodeId,
      chunkSeq: identity.chunkSeq,
      throughChunkSeq: identity.throughChunkSeq,
      chunk: projectedChunk
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

function normalizePending(chunk: CoalescableChunk, identity: ConversationStreamIdentity): PendingDelta {
  if (chunk.type === 'tool-input-delta') {
    return {
      type: 'tool-input-delta',
      identifier: chunk.toolCallId,
      identity,
      text: chunk.inputTextDelta
    }
  }
  return {
    type: chunk.type,
    identifier: chunk.id,
    identity,
    text: chunk.delta
  }
}

function rebuildChunk(p: PendingDelta): UIMessageChunk {
  if (p.type === 'tool-input-delta') {
    return { type: 'tool-input-delta', toolCallId: p.identifier, inputTextDelta: p.text } as UIMessageChunk
  }
  return { type: p.type, id: p.identifier, delta: p.text } as UIMessageChunk
}
