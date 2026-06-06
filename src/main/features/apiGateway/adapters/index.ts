/**
 * API Server Adapters
 *
 * This module provides adapters for converting between different AI API formats.
 *
 * Architecture:
 * - Stream adapters: Convert AI SDK streams to various output formats (Anthropic, OpenAI)
 * - Message converters: Convert input message formats to AI SDK format
 * - SSE formatters: Format events for Server-Sent Events streaming
 * - Factory: Creates adapters and formatters based on output format
 */

// Stream Adapters
export { AiSdkToAnthropicSse } from './stream/AiSdkToAnthropicSse'
export { AiSdkToOpenAIResponsesSse } from './stream/AiSdkToOpenAiResponsesSse'
export { AiSdkToOpenAISse } from './stream/AiSdkToOpenAiSse'
export { BaseStreamAdapter } from './stream/BaseStreamAdapter'

// Message Converters
export { AnthropicMessageConverter, type ReasoningCache } from './converters/AnthropicMessageConverter'
export { type JsonSchemaLike, jsonSchemaToZod } from './converters/jsonSchemaToZod'
export { type ExtendedChatCompletionCreateParams, OpenAIMessageConverter } from './converters/OpenAiMessageConverter'
export {
  OpenAIResponsesMessageConverter,
  type ResponsesCreateParams
} from './converters/OpenAiResponsesMessageConverter'

// SSE Formatters
export { AnthropicSseFormatter } from './formatters/AnthropicSseFormatter'
export { OpenAiResponsesSseFormatter } from './formatters/OpenAiResponsesSseFormatter'
export { type ChatCompletionChunk, OpenAISseFormatter } from './formatters/OpenAiSseFormatter'

// Factory
export {
  type ConverterOptions,
  type InputParamsMap,
  MessageConverterFactory
} from './factory/MessageConverterFactory'
export { StreamAdapterFactory } from './factory/StreamAdapterFactory'

// Interfaces
export type {
  AdapterState,
  ContentBlockState,
  IMessageConverter,
  InputFormat,
  ISseFormatter,
  IStreamAdapter,
  OutputFormat,
  StreamAdapterOptions,
  StreamTextOptions
} from './interfaces'
