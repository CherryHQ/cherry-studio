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
export { AiSdkToAnthropicSSE } from './stream/AiSdkToAnthropicSSE'
export { AiSdkToOpenAISSE } from './stream/AiSdkToOpenAISSE'
export { BaseStreamAdapter } from './stream/BaseStreamAdapter'

// Message Converters
export { AnthropicMessageConverter, type ReasoningCache } from './converters/AnthropicMessageConverter'
export { type JsonSchemaLike, jsonSchemaToZod } from './converters/json-schema-to-zod'
export { type ExtendedChatCompletionCreateParams, OpenAIMessageConverter } from './converters/OpenAIMessageConverter'

// SSE Formatters
export { AnthropicSSEFormatter } from './formatters/AnthropicSSEFormatter'
export { type ChatCompletionChunk, OpenAISSEFormatter } from './formatters/OpenAISSEFormatter'

// Factory
export {
  type ConverterOptions,
  type InputParamsMap,
  MessageConverterFactory
} from './factory/MessageConverterFactory'
export { StreamAdapterFactory } from './factory/StreamAdapterFactory'

// Interfaces
export type {
  AdapterRegistryEntry,
  AdapterState,
  ContentBlockState,
  IMessageConverter,
  InputFormat,
  ISSEFormatter,
  IStreamAdapter,
  OutputFormat,
  StreamAdapterConstructor,
  StreamAdapterOptions,
  StreamTextOptions
} from './interfaces'
