/**
 * AI SDK to OpenAI Compatible SSE Adapter
 *
 * Converts AI SDK's fullStream (TextStreamPart) events to OpenAI-compatible Chat Completions API SSE format.
 * This enables any AI provider supported by AI SDK to be exposed via OpenAI-compatible API.
 *
 * Supports extended features used by OpenAI-compatible providers:
 * - reasoning_content: DeepSeek-style reasoning/thinking content
 * - Standard OpenAI fields: content, tool_calls, finish_reason, usage
 *
 * OpenAI SSE Event Flow:
 * 1. data: {chunk with role} - First chunk with assistant role
 * 2. data: {chunk with content/reasoning_content delta} - Incremental content updates
 * 3. data: {chunk with tool_calls} - Tool call deltas
 * 4. data: {chunk with finish_reason} - Final chunk with finish reason
 * 5. data: [DONE] - Stream complete
 *
 * @see https://platform.openai.com/docs/api-reference/chat/streaming
 */

import type OpenAI from '@cherrystudio/openai'
import { loggerService } from '@logger'
import type { FinishReason, UIMessageChunk } from 'ai'

import type { GatewayUsageMetadata, StreamAdapterOptions } from '../interfaces'
import { BaseStreamAdapter } from './BaseStreamAdapter'

const logger = loggerService.withContext('AiSdkToOpenAiSse')

/**
 * Use official OpenAI SDK types as base
 */
type ChatCompletionChunkBase = OpenAI.Chat.Completions.ChatCompletionChunk
type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion

/**
 * Extended delta type with reasoning_content support (DeepSeek-style)
 */
interface OpenAiCompatibleDelta {
  role?: 'assistant'
  content?: string | null
  reasoning_content?: string | null
  tool_calls?: ChatCompletionChunkBase['choices'][0]['delta']['tool_calls']
}

/**
 * Extended ChatCompletionChunk with reasoning_content support
 */
export interface OpenAiCompatibleChunk extends Omit<ChatCompletionChunkBase, 'choices'> {
  choices: Array<{
    index: number
    delta: OpenAiCompatibleDelta
    finish_reason: ChatCompletionChunkBase['choices'][0]['finish_reason']
    logprobs?: ChatCompletionChunkBase['choices'][0]['logprobs']
  }>
}

/**
 * Extended ChatCompletion message with reasoning_content support
 */
interface OpenAiCompatibleMessage extends OpenAI.Chat.Completions.ChatCompletionMessage {
  reasoning_content?: string | null
}

/**
 * Extended ChatCompletion with reasoning_content support
 */
export interface OpenAiCompatibleCompletion extends Omit<ChatCompletion, 'choices'> {
  choices: Array<{
    index: number
    message: OpenAiCompatibleMessage
    finish_reason: ChatCompletion['choices'][0]['finish_reason']
    logprobs: ChatCompletion['choices'][0]['logprobs']
  }>
}

/**
 * OpenAI finish reasons
 */
type OpenAiFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | null

/**
 * Tool call state for tracking incremental tool calls
 */
interface ToolCallState {
  index: number
  id: string
  name: string
  arguments: string
}

/**
 * Adapter that converts AI SDK fullStream events to OpenAI-compatible SSE events
 *
 * Uses TransformStream for composable stream processing:
 * ```
 * const adapter = new AiSdkToOpenAiSse({ model: 'gpt-4' })
 * const outputStream = adapter.transform(aiSdkStream)
 * ```
 */
export class AiSdkToOpenAiSse extends BaseStreamAdapter<OpenAiCompatibleChunk> {
  private createdTimestamp: number
  private toolCalls: Map<string, ToolCallState> = new Map()
  private currentToolCallIndex = 0
  private finishReason: OpenAiFinishReason = null
  private reasoningContent = ''

  constructor(options: StreamAdapterOptions) {
    super(options)
    this.createdTimestamp = Math.floor(Date.now() / 1000)
  }

  /**
   * Create a base chunk structure
   */
  private createBaseChunk(delta: OpenAiCompatibleDelta): OpenAiCompatibleChunk {
    return {
      id: `chatcmpl-${this.state.messageId}`,
      object: 'chat.completion.chunk',
      created: this.createdTimestamp,
      model: this.state.model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: null
        }
      ]
    }
  }

  /**
   * Emit the initial message start event (with role)
   */
  protected emitMessageStart(): void {
    if (this.state.hasEmittedMessageStart) return

    this.state.hasEmittedMessageStart = true

    // Emit initial chunk with role
    const chunk = this.createBaseChunk({ role: 'assistant' })
    this.emit(chunk)
  }

  /**
   * Process a single UIMessageChunk and emit corresponding OpenAI events
   */
  protected processChunk(chunk: UIMessageChunk): void {
    // Log only the chunk type — full payloads can carry prompt/tool/reasoning content.
    logger.silly('AiSdkToOpenAiSse - Processing chunk', { type: chunk.type })
    switch (chunk.type) {
      // === Text Events ===
      // OpenAI has no separate text-start/text-end; only deltas matter.
      case 'text-delta':
        this.emitContentDelta(chunk.delta || '')
        break

      // === Reasoning/Thinking Events ===
      // Support DeepSeek-style reasoning_content. No separate start/end events.
      case 'reasoning-delta':
        this.emitReasoningDelta(chunk.delta || '')
        break

      // === Tool Events ===
      case 'tool-input-available':
        this.handleToolCall({
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: chunk.input
        })
        break

      case 'finish':
        this.handleFinish(chunk)
        break

      case 'message-metadata':
        this.applyUsageMetadata(chunk.messageMetadata as GatewayUsageMetadata | undefined)
        break

      case 'error':
        throw new Error(chunk.errorText)

      default:
        // start / start-step / finish-step / text-start / text-end /
        // reasoning-start / reasoning-end / tool-input-start / tool-input-delta /
        // tool-output-available / source-url / file / abort — no OpenAI chunk.
        break
    }
  }

  /** Track cumulative usage from the `message-metadata` projection. */
  private applyUsageMetadata(metadata: GatewayUsageMetadata | undefined): void {
    if (!metadata) return
    if (metadata.promptTokens !== undefined) this.state.inputTokens = metadata.promptTokens
    if (metadata.completionTokens !== undefined) this.state.outputTokens = metadata.completionTokens
  }

  private emitContentDelta(content: string): void {
    if (!content) return

    // Track content in state
    let textBlock = this.state.blocks.get(0)
    if (!textBlock) {
      textBlock = {
        type: 'text',
        index: 0,
        started: true,
        content: ''
      }
      this.state.blocks.set(0, textBlock)
    }
    textBlock.content += content

    const chunk = this.createBaseChunk({ content })
    this.emit(chunk)
  }

  private emitReasoningDelta(reasoningContent: string): void {
    if (!reasoningContent) return

    // Track reasoning content
    this.reasoningContent += reasoningContent

    // Also track in state blocks for non-streaming response
    let thinkingBlock = this.state.blocks.get(-1) // Use -1 for thinking block
    if (!thinkingBlock) {
      thinkingBlock = {
        type: 'thinking',
        index: -1,
        started: true,
        content: ''
      }
      this.state.blocks.set(-1, thinkingBlock)
    }
    thinkingBlock.content += reasoningContent

    // Emit chunk with reasoning_content (DeepSeek-style)
    const chunk = this.createBaseChunk({ reasoning_content: reasoningContent })
    this.emit(chunk)
  }

  private handleToolCall(params: { toolCallId: string; toolName: string; args: unknown }): void {
    const { toolCallId, toolName, args } = params

    if (this.toolCalls.has(toolCallId)) {
      return
    }

    const index = this.currentToolCallIndex++
    const argsString = JSON.stringify(args)

    this.toolCalls.set(toolCallId, {
      index,
      id: toolCallId,
      name: toolName,
      arguments: argsString
    })

    // Emit tool call chunk
    const chunk = this.createBaseChunk({
      tool_calls: [
        {
          index,
          id: toolCallId,
          type: 'function',
          function: {
            name: toolName,
            arguments: argsString
          }
        }
      ]
    })

    this.emit(chunk)
    this.finishReason = 'tool_calls'
  }

  private handleFinish(chunk: { finishReason?: FinishReason; messageMetadata?: unknown }): void {
    this.applyUsageMetadata(chunk.messageMetadata as GatewayUsageMetadata | undefined)

    if (!this.finishReason) {
      switch (chunk.finishReason) {
        case 'stop':
          this.finishReason = 'stop'
          break
        case 'length':
          this.finishReason = 'length'
          break
        case 'tool-calls':
          this.finishReason = 'tool_calls'
          break
        case 'content-filter':
          this.finishReason = 'content_filter'
          break
        default:
          this.finishReason = 'stop'
      }
    }

    this.state.stopReason = this.finishReason
  }

  /**
   * Finalize the stream and emit closing events
   */
  protected finalize(): void {
    // Emit final chunk with finish_reason and usage
    const finalChunk: OpenAiCompatibleChunk = {
      id: `chatcmpl-${this.state.messageId}`,
      object: 'chat.completion.chunk',
      created: this.createdTimestamp,
      model: this.state.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: this.finishReason || 'stop'
        }
      ],
      usage: {
        prompt_tokens: this.state.inputTokens,
        completion_tokens: this.state.outputTokens,
        total_tokens: this.state.inputTokens + this.state.outputTokens
      }
    }

    this.emit(finalChunk)
  }

  /**
   * Build a complete ChatCompletion object for non-streaming responses
   */
  buildNonStreamingResponse(): OpenAiCompatibleCompletion {
    // Collect text content
    let content: string | null = null
    const textBlock = this.state.blocks.get(0)
    if (textBlock && textBlock.type === 'text' && textBlock.content) {
      content = textBlock.content
    }

    // Collect reasoning content
    let reasoningContent: string | null = null
    const thinkingBlock = this.state.blocks.get(-1)
    if (thinkingBlock && thinkingBlock.type === 'thinking' && thinkingBlock.content) {
      reasoningContent = thinkingBlock.content
    }

    // Collect tool calls
    const toolCallsArray: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = Array.from(
      this.toolCalls.values()
    ).map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: tc.arguments
      }
    }))

    const message: OpenAiCompatibleMessage = {
      role: 'assistant',
      content,
      refusal: null,
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      ...(toolCallsArray.length > 0 ? { tool_calls: toolCallsArray } : {})
    }

    return {
      id: `chatcmpl-${this.state.messageId}`,
      object: 'chat.completion',
      created: this.createdTimestamp,
      model: this.state.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: this.finishReason || 'stop',
          logprobs: null
        }
      ],
      usage: {
        prompt_tokens: this.state.inputTokens,
        completion_tokens: this.state.outputTokens,
        total_tokens: this.state.inputTokens + this.state.outputTokens
      }
    }
  }
}

export default AiSdkToOpenAiSse
