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

import { googleReasoningCache, openRouterReasoningCache } from '../../services/reasoning-cache'
import type { StreamAdapterOptions } from '../interfaces'
import { BaseStreamAdapter } from './BaseStreamAdapter'

const logger = loggerService.withContext('AiSdkToAnthropicSSE')

/**
 * Adapter that converts AI SDK fullStream events to Anthropic SSE events
 *
 * Uses TransformStream for composable stream processing:
 * ```
 * const adapter = new AiSdkToAnthropicSSE({ model: 'claude-3' })
 * const outputStream = adapter.transform(aiSdkStream)
 * ```
 */
export class AiSdkToAnthropicSSE extends BaseStreamAdapter<RawMessageStreamEvent> {
  constructor(options: StreamAdapterOptions) {
    super(options)
  }

  /**
   * Emit the initial message_start event
   */
  protected emitMessageStart(): void {
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

    this.emit(event)
  }

  /**
   * Process a single AI SDK chunk and emit corresponding Anthropic events
   */
  protected processChunk(chunk: TextStreamPart<ToolSet>): void {
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
        if (googleReasoningCache && chunk.providerMetadata?.google?.thoughtSignature) {
          googleReasoningCache.set(
            `google-${chunk.toolName}`,
            chunk.providerMetadata?.google?.thoughtSignature as string
          )
        }
        if (
          openRouterReasoningCache &&
          chunk.providerMetadata?.openrouter?.reasoning_details &&
          Array.isArray(chunk.providerMetadata.openrouter.reasoning_details)
        ) {
          openRouterReasoningCache.set(
            `openrouter-${chunk.toolCallId}`,
            JSON.parse(JSON.stringify(chunk.providerMetadata.openrouter.reasoning_details))
          )
        }
        this.handleToolCall({
          type: 'tool-call',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: chunk.input
        })
        break

      case 'tool-result':
        // Tool results are handled differently in Anthropic format
        break

      case 'finish-step':
        if (chunk.finishReason === 'tool-calls') {
          this.state.stopReason = 'tool_use'
        }
        break

      case 'finish':
        this.handleFinish(chunk)
        break

      case 'error':
        throw chunk.error

      default:
        break
    }
  }

  private startTextBlock(): void {
    if (this.state.textBlockIndex !== null) return

    const index = this.allocateBlockIndex()
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

    this.emit(event)
  }

  private emitTextDelta(text: string): void {
    if (!text) return

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

    this.emit(event)
  }

  private stopTextBlock(): void {
    if (this.state.textBlockIndex === null) return

    const index = this.state.textBlockIndex

    const event: RawContentBlockStopEvent = {
      type: 'content_block_stop',
      index
    }

    this.emit(event)
    this.state.textBlockIndex = null
  }

  private startThinkingBlock(reasoningId: string): void {
    if (this.state.thinkingBlocks.has(reasoningId)) return

    const index = this.allocateBlockIndex()
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

    this.emit(event)
  }

  private emitThinkingDelta(text: string, reasoningId?: string): void {
    if (!text) return

    const targetId = reasoningId || this.state.currentThinkingId
    if (!targetId) {
      const newId = `reasoning_${Date.now()}`
      this.startThinkingBlock(newId)
      return this.emitThinkingDelta(text, newId)
    }

    const index = this.state.thinkingBlocks.get(targetId)
    if (index === undefined) {
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

    this.emit(event)
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

    this.emit(event)
    this.state.thinkingBlocks.delete(targetId)

    if (this.state.currentThinkingId === targetId) {
      const remaining = Array.from(this.state.thinkingBlocks.keys())
      this.state.currentThinkingId = remaining.length > 0 ? remaining[remaining.length - 1] : null
    }
  }

  private handleToolCall(chunk: { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }): void {
    const { toolCallId, toolName, args } = chunk

    if (this.state.toolBlocks.has(toolCallId)) {
      return
    }

    const index = this.allocateBlockIndex()
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

    this.emit(startEvent)

    // Emit the full input as a delta
    const delta: InputJSONDelta = {
      type: 'input_json_delta',
      partial_json: inputJson
    }

    const deltaEvent: RawContentBlockDeltaEvent = {
      type: 'content_block_delta',
      index,
      delta
    }

    this.emit(deltaEvent)

    // Emit content_block_stop
    const stopEvent: RawContentBlockStopEvent = {
      type: 'content_block_stop',
      index
    }

    this.emit(stopEvent)

    this.state.stopReason = 'tool_use'
  }

  private handleFinish(chunk: { type: 'finish'; finishReason?: FinishReason; totalUsage?: LanguageModelUsage }): void {
    if (chunk.totalUsage) {
      this.state.inputTokens = chunk.totalUsage.inputTokens || 0
      this.state.outputTokens = chunk.totalUsage.outputTokens || 0
      this.state.cacheInputTokens = chunk.totalUsage.cachedInputTokens || 0
    }

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

  /**
   * Finalize the stream and emit closing events
   */
  protected finalize(): void {
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
        stop_reason: (this.state.stopReason as StopReason) || 'end_turn',
        stop_sequence: null
      },
      usage
    }

    this.emit(messageDeltaEvent)

    // Emit message_stop
    const messageStopEvent: RawMessageStopEvent = {
      type: 'message_stop'
    }

    this.emit(messageStopEvent)
  }

  /**
   * Build a complete Message object for non-streaming responses
   */
  buildNonStreamingResponse(): Message {
    const content: ContentBlock[] = []

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
      stop_reason: (this.state.stopReason as StopReason) || 'end_turn',
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

export default AiSdkToAnthropicSSE
