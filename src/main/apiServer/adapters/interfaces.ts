/**
 * Core interfaces for the API Server adapter system
 *
 * This module defines the contracts for:
 * - Stream adapters: Transform AI SDK streams to various output formats
 * - Message converters: Convert between API message formats
 * - SSE formatters: Format events for Server-Sent Events
 */

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { Provider } from '@types'
import type { ModelMessage, TextStreamPart, ToolSet } from 'ai'

/**
 * Supported output formats for stream adapters
 */
export type OutputFormat = 'anthropic' | 'openai' | 'gemini' | 'openai-responses'

/**
 * Supported input formats for message converters
 */
export type InputFormat = 'anthropic' | 'openai'

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
   * Transform AI SDK stream to target format stream
   * @param input - ReadableStream from AI SDK's fullStream
   * @returns ReadableStream of formatted output events
   */
  transform(input: ReadableStream<TextStreamPart<ToolSet>>): ReadableStream<TOutputEvent>

  /**
   * Get the internal TransformStream for advanced use cases
   */
  getTransformStream(): TransformStream<TextStreamPart<ToolSet>, TOutputEvent>

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
   * Convert input params to AI SDK ModelMessage[]
   */
  toAiSdkMessages(params: TInputParams): ModelMessage[]

  /**
   * Convert input tools to AI SDK tools format
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
export interface ISSEFormatter<TEvent = unknown> {
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
  cacheInputTokens: number
  currentBlockIndex: number
  blocks: Map<number, ContentBlockState>
  textBlockIndex: number | null
  thinkingBlocks: Map<string, number>
  currentThinkingId: string | null
  toolBlocks: Map<string, number>
  stopReason: string | null
  hasEmittedMessageStart: boolean
}

/**
 * Constructor type for stream adapters
 */
export type StreamAdapterConstructor<TOutputEvent = unknown> = new (
  options: StreamAdapterOptions
) => IStreamAdapter<TOutputEvent>

/**
 * Registry entry for adapter factory
 */
export interface AdapterRegistryEntry<TOutputEvent = unknown> {
  format: OutputFormat
  adapterClass: StreamAdapterConstructor<TOutputEvent>
  formatterClass: new () => ISSEFormatter<TOutputEvent>
}
