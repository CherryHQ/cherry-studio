/**
 * AI SDK to Anthropic SSE Adapter
 *
 * Converts AI SDK's fullStream (TextStreamPart) events to Anthropic Messages API SSE format.
 * This enables any AI provider supported by AI SDK to be exposed via Anthropic-compatible API.
 *
 * Anthropic SSE Event Flow:
 * 1. message_start - Initial message with metadata
 * 2. content_block_start - Begin a content block (text, tool_use, thinking)
 * 3. content_block_delta - Incremental content updates
 * 4. content_block_stop - End a content block
 * 5. message_delta - Updates to overall message (stop_reason, usage)
 * 6. message_stop - Stream complete
 *
 * @see https://docs.anthropic.com/en/api/messages-streaming
 */

import type {
  ContentBlock,
  InputJSONDelta,
  Message,
  MessageDeltaUsage,
  RawContentBlockDeltaEvent,
  RawContentBlockStartEvent,
  RawContentBlockStopEvent,
  RawMessageDeltaEvent,
  RawMessageStartEvent,
  RawMessageStopEvent,
  RawMessageStreamEvent,
  StopReason,
  TextBlock,
  TextDelta,
  ThinkingBlock,
  ThinkingDelta,
  ToolUseBlock,
  Usage
} from '@anthropic-ai/sdk/resources/messages'
import { loggerService } from '@logger'
import type { FinishReason, LanguageModelUsage, TextStreamPart, ToolSet } from 'ai'

const logger = loggerService.withContext('AiSdkToAnthropicSSE')

interface ContentBlockState {
  type: 'text' | 'tool_use' | 'thinking'
  index: number
  started: boolean
  content: string
  // For tool_use blocks
  toolId?: string
  toolName?: string
  toolInput?: string
}

interface AdapterState {
  messageId: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheInputTokens: number
  currentBlockIndex: number
  blocks: Map<number, ContentBlockState>
  textBlockIndex: number | null
  // Track multiple thinking blocks by their reasoning ID
  thinkingBlocks: Map<string, number> // reasoningId -> blockIndex
  currentThinkingId: string | null // Currently active thinking block ID
  toolBlocks: Map<string, number> // toolCallId -> blockIndex
  stopReason: StopReason | null
  hasEmittedMessageStart: boolean
}

export type SSEEventCallback = (event: RawMessageStreamEvent) => void

export interface AiSdkToAnthropicSSEOptions {
  model: string
  messageId?: string
  inputTokens?: number
  onEvent: SSEEventCallback
}

/**
 * Adapter that converts AI SDK fullStream events to Anthropic SSE events
 */
export class AiSdkToAnthropicSSE {
  private state: AdapterState
  private onEvent: SSEEventCallback

  constructor(options: AiSdkToAnthropicSSEOptions) {
    this.onEvent = options.onEvent
    this.state = {
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
   * Process the AI SDK stream and emit Anthropic SSE events
   */
  async processStream(fullStream: ReadableStream<TextStreamPart<ToolSet>>): Promise<void> {
    const reader = fullStream.getReader()

    try {
      // Emit message_start at the beginning
      this.emitMessageStart()

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        this.processChunk(value)
      }

      // Ensure all blocks are closed and emit final events
      this.finalize()
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Process a single AI SDK chunk and emit corresponding Anthropic events
   */
  private processChunk(chunk: TextStreamPart<ToolSet>): void {
    logger.silly('AiSdkToAnthropicSSE - Processing chunk:', { chunk: JSON.stringify(chunk) })
    switch (chunk.type) {
      // === Text Events ===
      case 'text-start':
        this.startTextBlock()
        break

      case 'text-delta':
        this.emitTextDelta(chunk.text || '')
        break

      case 'text-end':
        this.stopTextBlock()
        break

      // === Reasoning/Thinking Events ===
      case 'reasoning-start': {
        const reasoningId = chunk.id
        this.startThinkingBlock(reasoningId)
        break
      }

      case 'reasoning-delta': {
        const reasoningId = chunk.id
        this.emitThinkingDelta(chunk.text || '', reasoningId)
        break
      }

      case 'reasoning-end': {
        const reasoningId = chunk.id
        this.stopThinkingBlock(reasoningId)
        break
      }

      // === Tool Events ===
      case 'tool-call':
        this.handleToolCall({
          type: 'tool-call',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: chunk.input
        })
        break

      case 'tool-result':
        // this.handleToolResult({
        //   type: 'tool-result',
        //   toolCallId: chunk.toolCallId,
        //   toolName: chunk.toolName,
        //   args: chunk.input,
        //   result: chunk.output
        // })
        break

      // === Completion Events ===
      case 'finish-step':
        if (chunk.finishReason === 'tool-calls') {
          this.state.stopReason = 'tool_use'
        }
        break

      case 'finish':
        this.handleFinish(chunk)
        break

      // === Error Events ===
      case 'error':
        this.handleError(chunk.error)
        break

      // Ignore other event types
      default:
        break
    }
  }

  private emitMessageStart(): void {
    if (this.state.hasEmittedMessageStart) return

    this.state.hasEmittedMessageStart = true

    const usage: Usage = {
      input_tokens: this.state.inputTokens,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: null
    }

    const message: Message = {
      id: this.state.messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: this.state.model,
      stop_reason: null,
      stop_sequence: null,
      usage
    }

    const event: RawMessageStartEvent = {
      type: 'message_start',
      message
    }

    this.onEvent(event)
  }

  private startTextBlock(): void {
    // If we already have a text block, don't create another
    if (this.state.textBlockIndex !== null) return

    const index = this.state.currentBlockIndex++
    this.state.textBlockIndex = index
    this.state.blocks.set(index, {
      type: 'text',
      index,
      started: true,
      content: ''
    })

    const contentBlock: TextBlock = {
      type: 'text',
      text: '',
      citations: null
    }

    const event: RawContentBlockStartEvent = {
      type: 'content_block_start',
      index,
      content_block: contentBlock
    }

    this.onEvent(event)
  }

  private emitTextDelta(text: string): void {
    if (!text) return

    // Auto-start text block if not started
    if (this.state.textBlockIndex === null) {
      this.startTextBlock()
    }

    const index = this.state.textBlockIndex!
    const block = this.state.blocks.get(index)
    if (block) {
      block.content += text
    }

    const delta: TextDelta = {
      type: 'text_delta',
      text
    }

    const event: RawContentBlockDeltaEvent = {
      type: 'content_block_delta',
      index,
      delta
    }

    this.onEvent(event)
  }

  private stopTextBlock(): void {
    if (this.state.textBlockIndex === null) return

    const index = this.state.textBlockIndex

    const event: RawContentBlockStopEvent = {
      type: 'content_block_stop',
      index
    }

    this.onEvent(event)
    this.state.textBlockIndex = null
  }

  private startThinkingBlock(reasoningId: string): void {
    // Check if this thinking block already exists
    if (this.state.thinkingBlocks.has(reasoningId)) return

    const index = this.state.currentBlockIndex++
    this.state.thinkingBlocks.set(reasoningId, index)
    this.state.currentThinkingId = reasoningId
    this.state.blocks.set(index, {
      type: 'thinking',
      index,
      started: true,
      content: ''
    })

    const contentBlock: ThinkingBlock = {
      type: 'thinking',
      thinking: '',
      signature: ''
    }

    const event: RawContentBlockStartEvent = {
      type: 'content_block_start',
      index,
      content_block: contentBlock
    }

    this.onEvent(event)
  }

  private emitThinkingDelta(text: string, reasoningId?: string): void {
    if (!text) return

    // Determine which thinking block to use
    const targetId = reasoningId || this.state.currentThinkingId
    if (!targetId) {
      // Auto-start thinking block if not started
      const newId = `reasoning_${Date.now()}`
      this.startThinkingBlock(newId)
      return this.emitThinkingDelta(text, newId)
    }

    const index = this.state.thinkingBlocks.get(targetId)
    if (index === undefined) {
      // If the block doesn't exist, create it
      this.startThinkingBlock(targetId)
      return this.emitThinkingDelta(text, targetId)
    }

    const block = this.state.blocks.get(index)
    if (block) {
      block.content += text
    }

    const delta: ThinkingDelta = {
      type: 'thinking_delta',
      thinking: text
    }

    const event: RawContentBlockDeltaEvent = {
      type: 'content_block_delta',
      index,
      delta
    }

    this.onEvent(event)
  }

  private stopThinkingBlock(reasoningId?: string): void {
    const targetId = reasoningId || this.state.currentThinkingId
    if (!targetId) return

    const index = this.state.thinkingBlocks.get(targetId)
    if (index === undefined) return

    const event: RawContentBlockStopEvent = {
      type: 'content_block_stop',
      index
    }

    this.onEvent(event)
    this.state.thinkingBlocks.delete(targetId)

    // Update currentThinkingId if we just closed the current one
    if (this.state.currentThinkingId === targetId) {
      // Set to the most recent remaining thinking block, or null if none
      const remaining = Array.from(this.state.thinkingBlocks.keys())
      this.state.currentThinkingId = remaining.length > 0 ? remaining[remaining.length - 1] : null
    }
  }

  private handleToolCall(chunk: { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }): void {
    const { toolCallId, toolName, args } = chunk

    // Check if we already have this tool call
    if (this.state.toolBlocks.has(toolCallId)) {
      return
    }

    const index = this.state.currentBlockIndex++
    this.state.toolBlocks.set(toolCallId, index)

    const inputJson = JSON.stringify(args)

    this.state.blocks.set(index, {
      type: 'tool_use',
      index,
      started: true,
      content: inputJson,
      toolId: toolCallId,
      toolName,
      toolInput: inputJson
    })

    // Emit content_block_start for tool_use
    const contentBlock: ToolUseBlock = {
      type: 'tool_use',
      id: toolCallId,
      name: toolName,
      input: {}
    }

    const startEvent: RawContentBlockStartEvent = {
      type: 'content_block_start',
      index,
      content_block: contentBlock
    }

    this.onEvent(startEvent)

    // Emit the full input as a delta (Anthropic streams JSON incrementally)
    const delta: InputJSONDelta = {
      type: 'input_json_delta',
      partial_json: inputJson
    }

    const deltaEvent: RawContentBlockDeltaEvent = {
      type: 'content_block_delta',
      index,
      delta
    }

    this.onEvent(deltaEvent)

    // Emit content_block_stop
    const stopEvent: RawContentBlockStopEvent = {
      type: 'content_block_stop',
      index
    }

    this.onEvent(stopEvent)

    // Mark that we have tool use
    this.state.stopReason = 'tool_use'
  }

  private handleFinish(chunk: { type: 'finish'; finishReason?: FinishReason; totalUsage?: LanguageModelUsage }): void {
    // Update usage
    if (chunk.totalUsage) {
      this.state.inputTokens = chunk.totalUsage.inputTokens || 0
      this.state.outputTokens = chunk.totalUsage.outputTokens || 0
      this.state.cacheInputTokens = chunk.totalUsage.cachedInputTokens || 0
    }

    // Determine finish reason
    if (!this.state.stopReason) {
      switch (chunk.finishReason) {
        case 'stop':
          this.state.stopReason = 'end_turn'
          break
        case 'length':
          this.state.stopReason = 'max_tokens'
          break
        case 'tool-calls':
          this.state.stopReason = 'tool_use'
          break
        case 'content-filter':
          this.state.stopReason = 'refusal'
          break
        default:
          this.state.stopReason = 'end_turn'
      }
    }
  }

  private handleError(error: unknown): void {
    // Log the error for debugging
    logger.warn('AiSdkToAnthropicSSE - Provider error received:', { error })

    // Extract error message
    let errorMessage = 'Unknown error from provider'
    if (error && typeof error === 'object') {
      const err = error as { message?: string; metadata?: { raw?: string } }
      if (err.metadata?.raw) {
        errorMessage = `Provider error: ${err.metadata.raw}`
      } else if (err.message) {
        errorMessage = err.message
      }
    } else if (typeof error === 'string') {
      errorMessage = error
    }

    // Emit error as a text block so the user can see it
    // First close any open thinking blocks to maintain proper event order
    for (const reasoningId of Array.from(this.state.thinkingBlocks.keys())) {
      this.stopThinkingBlock(reasoningId)
    }

    // Emit the error as text
    this.emitTextDelta(`\n\n[Error: ${errorMessage}]\n`)
  }

  private finalize(): void {
    // Close any open blocks
    if (this.state.textBlockIndex !== null) {
      this.stopTextBlock()
    }
    // Close all open thinking blocks
    for (const reasoningId of this.state.thinkingBlocks.keys()) {
      this.stopThinkingBlock(reasoningId)
    }

    // Emit message_delta with final stop reason and usage
    const usage: MessageDeltaUsage = {
      output_tokens: this.state.outputTokens,
      input_tokens: this.state.inputTokens,
      cache_creation_input_tokens: this.state.cacheInputTokens,
      cache_read_input_tokens: null,
      server_tool_use: null
    }

    const messageDeltaEvent: RawMessageDeltaEvent = {
      type: 'message_delta',
      delta: {
        stop_reason: this.state.stopReason || 'end_turn',
        stop_sequence: null
      },
      usage
    }

    this.onEvent(messageDeltaEvent)

    // Emit message_stop
    const messageStopEvent: RawMessageStopEvent = {
      type: 'message_stop'
    }

    this.onEvent(messageStopEvent)
  }

  /**
   * Set input token count (typically from prompt)
   */
  setInputTokens(count: number): void {
    this.state.inputTokens = count
  }

  /**
   * Get the current message ID
   */
  getMessageId(): string {
    return this.state.messageId
  }

  /**
   * Build a complete Message object for non-streaming responses
   */
  buildNonStreamingResponse(): Message {
    const content: ContentBlock[] = []

    // Collect all content blocks in order
    const sortedBlocks = Array.from(this.state.blocks.values()).sort((a, b) => a.index - b.index)

    for (const block of sortedBlocks) {
      switch (block.type) {
        case 'text':
          content.push({
            type: 'text',
            text: block.content,
            citations: null
          } as TextBlock)
          break
        case 'thinking':
          content.push({
            type: 'thinking',
            thinking: block.content
          } as ThinkingBlock)
          break
        case 'tool_use':
          content.push({
            type: 'tool_use',
            id: block.toolId!,
            name: block.toolName!,
            input: JSON.parse(block.toolInput || '{}')
          } as ToolUseBlock)
          break
      }
    }

    return {
      id: this.state.messageId,
      type: 'message',
      role: 'assistant',
      content,
      model: this.state.model,
      stop_reason: this.state.stopReason || 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: this.state.inputTokens,
        output_tokens: this.state.outputTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        server_tool_use: null
      }
    }
  }
}

/**
 * Format an Anthropic SSE event for HTTP streaming
 */
export function formatSSEEvent(event: RawMessageStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

/**
 * Create a done marker for SSE stream
 */
export function formatSSEDone(): string {
  return 'data: [DONE]\n\n'
}

export default AiSdkToAnthropicSSE
