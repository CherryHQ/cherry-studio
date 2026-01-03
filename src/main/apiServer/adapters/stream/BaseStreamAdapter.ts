/**
 * Base Stream Adapter
 *
 * Abstract base class for stream adapters that provides:
 * - Shared state management (messageId, tokens, blocks, etc.)
 * - TransformStream implementation
 * - Common utility methods
 */

import type { TextStreamPart, ToolSet } from 'ai'

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
  protected controller: TransformStreamDefaultController<TOutputEvent> | null = null
  private transformStream: TransformStream<TextStreamPart<ToolSet>, TOutputEvent>

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
      cacheInputTokens: 0,
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
  private createTransformStream(): TransformStream<TextStreamPart<ToolSet>, TOutputEvent> {
    return new TransformStream<TextStreamPart<ToolSet>, TOutputEvent>({
      start: (controller) => {
        this.controller = controller
        // Note: emitMessageStart is called lazily in transform or finalize
        // to allow configuration changes (like setInputTokens) after construction
      },
      transform: (chunk, _controller) => {
        // Ensure message_start is emitted before processing chunks
        this.emitMessageStart()
        this.processChunk(chunk)
      },
      flush: (_controller) => {
        // Ensure message_start is emitted even for empty streams
        this.emitMessageStart()
        this.finalize()
      }
    })
  }

  /**
   * Transform input stream to output stream
   */
  transform(input: ReadableStream<TextStreamPart<ToolSet>>): ReadableStream<TOutputEvent> {
    return input.pipeThrough(this.transformStream)
  }

  /**
   * Get the internal TransformStream
   */
  getTransformStream(): TransformStream<TextStreamPart<ToolSet>, TOutputEvent> {
    return this.transformStream
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
   * Emit an event to the output stream
   */
  protected emit(event: TOutputEvent): void {
    if (this.controller) {
      this.controller.enqueue(event)
    }
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
  protected abstract processChunk(chunk: TextStreamPart<ToolSet>): void

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
