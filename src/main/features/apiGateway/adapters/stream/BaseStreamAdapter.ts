/**
 * Base Stream Adapter
 *
 * Abstract base class for stream adapters that provides:
 * - Shared state management (messageId, tokens, blocks, etc.)
 * - TransformStream implementation
 * - Common utility methods
 */

import type { UIMessageChunk } from 'ai'

import type { AdapterState, ContentBlockState, IStreamAdapter, StreamAdapterOptions } from '../interfaces'

/**
 * Abstract base class for stream adapters
 *
 * Subclasses must implement:
 * - processChunk(): Handle individual stream chunks
 * - emitMessageStart(): Emit initial message event
 * - finalize(): Clean up and emit final events
 * - buildNonStreamingResponse(): Build complete response object
 */
export abstract class BaseStreamAdapter<TOutputEvent> implements IStreamAdapter<TOutputEvent> {
  protected state: AdapterState
  /** Events produced by the current `processChunk`/`finalize`, drained by the active driver. */
  private pendingEvents: TOutputEvent[] = []
  private transformStream: TransformStream<UIMessageChunk, TOutputEvent>

  constructor(options: StreamAdapterOptions) {
    this.state = this.createInitialState(options)
    this.transformStream = this.createTransformStream()
  }

  /**
   * Create initial adapter state
   */
  protected createInitialState(options: StreamAdapterOptions): AdapterState {
    return {
      messageId: options.messageId || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      model: options.model,
      inputTokens: options.inputTokens || 0,
      outputTokens: 0,
      currentBlockIndex: 0,
      blocks: new Map(),
      textBlockIndex: null,
      thinkingBlocks: new Map(),
      currentThinkingId: null,
      toolBlocks: new Map(),
      stopReason: null,
      hasEmittedMessageStart: false
    }
  }

  /**
   * Create the TransformStream for processing
   */
  private createTransformStream(): TransformStream<UIMessageChunk, TOutputEvent> {
    // emitMessageStart is called lazily in transformChunk/finalizeEvents to
    // allow configuration changes (like setInputTokens) after construction.
    return new TransformStream<UIMessageChunk, TOutputEvent>({
      transform: (chunk, controller) => {
        for (const event of this.transformChunk(chunk)) controller.enqueue(event)
      },
      flush: (controller) => {
        for (const event of this.finalizeEvents()) controller.enqueue(event)
      }
    })
  }

  /**
   * Transform input stream to output stream
   */
  transform(input: ReadableStream<UIMessageChunk>): ReadableStream<TOutputEvent> {
    return input.pipeThrough(this.transformStream)
  }

  /**
   * Get the internal TransformStream
   */
  getTransformStream(): TransformStream<UIMessageChunk, TOutputEvent> {
    return this.transformStream
  }

  /**
   * Push API: process one chunk and return the events it produced.
   * Used by the AiStreamManager `SseListener` path (push), while the
   * TransformStream path (pull) calls it internally. Lazily emits
   * `message_start` first (idempotent).
   */
  transformChunk(chunk: UIMessageChunk): TOutputEvent[] {
    this.emitMessageStart()
    this.processChunk(chunk)
    return this.drainPending()
  }

  /**
   * Push API: finalize the stream and return the closing events. Emits
   * `message_start` first so empty streams still produce a valid response.
   */
  finalizeEvents(): TOutputEvent[] {
    this.emitMessageStart()
    this.finalize()
    return this.drainPending()
  }

  private drainPending(): TOutputEvent[] {
    const events = this.pendingEvents
    this.pendingEvents = []
    return events
  }

  /**
   * Get message ID
   */
  getMessageId(): string {
    return this.state.messageId
  }

  /**
   * Set input token count
   */
  setInputTokens(count: number): void {
    this.state.inputTokens = count
  }

  /**
   * Emit an event. Buffered into `pendingEvents`; the active driver
   * (TransformStream transform/flush, or the push API) drains it.
   */
  protected emit(event: TOutputEvent): void {
    this.pendingEvents.push(event)
  }

  /**
   * Get or create a content block
   */
  protected getOrCreateBlock(index: number, type: ContentBlockState['type']): ContentBlockState {
    let block = this.state.blocks.get(index)
    if (!block) {
      block = {
        type,
        index,
        started: false,
        content: ''
      }
      this.state.blocks.set(index, block)
    }
    return block
  }

  /**
   * Allocate a new block index
   */
  protected allocateBlockIndex(): number {
    return this.state.currentBlockIndex++
  }

  // ===== Abstract methods to be implemented by subclasses =====

  /**
   * Process a single chunk from the AI SDK stream
   */
  protected abstract processChunk(chunk: UIMessageChunk): void

  /**
   * Emit the initial message start event
   */
  protected abstract emitMessageStart(): void

  /**
   * Finalize the stream and emit closing events
   */
  protected abstract finalize(): void

  /**
   * Build a non-streaming response from accumulated state
   */
  abstract buildNonStreamingResponse(): unknown
}

export default BaseStreamAdapter
