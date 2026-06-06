/**
 * Core interfaces for the API Server adapter system
 *
 * This module defines the contracts for:
 * - Stream adapters: Transform AI SDK streams to various output formats
 * - Message converters: Convert between API message formats
 * - SSE formatters: Format events for Server-Sent Events
 */

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { Provider } from '@shared/data/types/provider'
import type { ToolSet, UIMessageChunk } from 'ai'

/**
 * Token usage projection carried on `message-metadata` UIMessageChunks emitted
 * by main's `AiService.streamText`. Mirrors the Cherry `MessageStats` projection
 * (`promptTokens` = input, `completionTokens` = output, `thoughtsTokens` =
 * reasoning). There is no raw input/output token field and no cache-token
 * breakdown on this channel.
 */
export interface GatewayUsageMetadata {
  totalTokens?: number
  promptTokens?: number
  completionTokens?: number
  thoughtsTokens?: number
}

/**
 * Supported output formats for stream adapters
 */
export type OutputFormat = 'anthropic' | 'openai' | 'openai-responses'

/**
 * Supported input formats for message converters
 */
export type InputFormat = 'anthropic' | 'openai' | 'openai-responses'

/**
 * Stream text options extracted from input params
 * These are the common parameters used by AI SDK's streamText/generateText
 */
export interface StreamTextOptions {
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  stopSequences?: string[]
}

/**
 * Stream Adapter Interface
 *
 * Uses TransformStream pattern for composability:
 * ```
 * input.pipeThrough(adapter1.getTransformStream()).pipeThrough(adapter2.getTransformStream())
 * ```
 */
export interface IStreamAdapter<TOutputEvent = unknown> {
  /**
   * Transform the AI SDK UI-message stream to a target-format event stream.
   * @param input - ReadableStream of UIMessageChunk from `AiService.streamText`
   * @returns ReadableStream of formatted output events
   */
  transform(input: ReadableStream<UIMessageChunk>): ReadableStream<TOutputEvent>

  /**
   * Get the internal TransformStream for advanced use cases
   */
  getTransformStream(): TransformStream<UIMessageChunk, TOutputEvent>

  /**
   * Push API: process one chunk and return the events it produced.
   * Used by the AiStreamManager `SseListener` path; lazily emits message_start.
   */
  transformChunk(chunk: UIMessageChunk): TOutputEvent[]

  /**
   * Push API: finalize the stream and return its closing events.
   */
  finalizeEvents(): TOutputEvent[]

  /**
   * Build a non-streaming response from accumulated state
   * Call after stream is fully consumed
   */
  buildNonStreamingResponse(): unknown

  /**
   * Get the message ID for this adapter instance
   */
  getMessageId(): string

  /**
   * Set input token count (for usage tracking)
   */
  setInputTokens(count: number): void
}

/**
 * Options for creating stream adapters
 */
export interface StreamAdapterOptions {
  /** Model identifier (e.g., "anthropic:claude-3-opus") */
  model: string
  /** Optional message ID, auto-generated if not provided */
  messageId?: string
  /** Initial input token count */
  inputTokens?: number
}

/**
 * Message Converter Interface
 *
 * Converts between different API message formats and AI SDK format.
 * Each converter handles a specific input format (OpenAI, Anthropic, etc.)
 */
export interface IMessageConverter<TInputParams = unknown> {
  /**
   * Convert input params to AI SDK `UIMessage[]`. Any system/instructions
   * prompt becomes a leading `{ role: 'system' }` UIMessage — main's pipeline
   * runs `convertToModelMessages`, which lifts that into the SDK `system`.
   */
  toUIMessages(params: TInputParams): CherryUIMessage[]

  /**
   * Convert input tools to AI SDK `ToolSet`. Tools have NO `execute` (client
   * tools): the model emits the call and the gateway forwards it to the client.
   */
  toAiSdkTools?(params: TInputParams): ToolSet | undefined

  /**
   * Extract stream/generation options from input params
   * Maps format-specific parameters to AI SDK common options
   */
  extractStreamOptions(params: TInputParams): StreamTextOptions

  /**
   * Extract provider-specific options from input params
   * Handles thinking/reasoning configuration based on provider type
   */
  extractProviderOptions(provider: Provider, params: TInputParams): ProviderOptions | undefined
}

/**
 * SSE Formatter Interface
 *
 * Formats events for Server-Sent Events streaming
 */
export interface ISseFormatter<TEvent = unknown> {
  /**
   * Format an event for SSE streaming
   * @returns Formatted string like "event: type\ndata: {...}\n\n"
   */
  formatEvent(event: TEvent): string

  /**
   * Format the stream termination marker
   * @returns Done marker like "data: [DONE]\n\n"
   */
  formatDone(): string
}

/**
 * Content block state for tracking streaming content
 */
export interface ContentBlockState {
  type: 'text' | 'tool_use' | 'thinking'
  index: number
  started: boolean
  content: string
  // For tool_use blocks
  toolId?: string
  toolName?: string
  toolInput?: string
}

/**
 * Adapter state for tracking stream processing
 */
export interface AdapterState {
  messageId: string
  model: string
  inputTokens: number
  outputTokens: number
  currentBlockIndex: number
  blocks: Map<number, ContentBlockState>
  textBlockIndex: number | null
  thinkingBlocks: Map<string, number>
  currentThinkingId: string | null
  toolBlocks: Map<string, number>
  stopReason: string | null
  hasEmittedMessageStart: boolean
}
