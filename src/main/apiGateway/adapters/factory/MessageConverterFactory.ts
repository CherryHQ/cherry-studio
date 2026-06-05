/**
 * Message Converter Factory
 *
 * Factory for creating message converters based on input format.
 * Uses generics for type-safe converter creation.
 */

import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'

import { AnthropicMessageConverter, type ReasoningCache } from '../converters/AnthropicMessageConverter'
import { type ExtendedChatCompletionCreateParams, OpenAIMessageConverter } from '../converters/OpenAIMessageConverter'
import {
  OpenAIResponsesMessageConverter,
  type ResponsesCreateParams
} from '../converters/OpenAIResponsesMessageConverter'
import type { IMessageConverter, InputFormat } from '../interfaces'

/**
 * Type mapping from input format to parameter type
 */
export type InputParamsMap = {
  openai: ExtendedChatCompletionCreateParams
  anthropic: MessageCreateParams
  'openai-responses': ResponsesCreateParams
}

/**
 * Options for creating converters
 */
export interface ConverterOptions {
  googleReasoningCache?: ReasoningCache
  openRouterReasoningCache?: ReasoningCache
}

/**
 * Message Converter Factory
 *
 * Creates message converters for different input formats with type safety.
 *
 * @example
 * ```typescript
 * const converter = MessageConverterFactory.create('anthropic', {
 *   googleReasoningCache,
 *   openRouterReasoningCache
 * })
 * // converter is typed as IMessageConverter<MessageCreateParams>
 * const messages = converter.toAiSdkMessages(params)
 * const options = converter.extractStreamOptions(params)
 * ```
 */
export class MessageConverterFactory {
  /**
   * Create a message converter for the specified input format
   *
   * @param format - The input format ('openai' | 'anthropic')
   * @param options - Optional converter options
   * @returns A typed message converter instance
   */
  static create<T extends InputFormat>(
    format: T,
    options: ConverterOptions = {}
  ): IMessageConverter<InputParamsMap[T]> {
    if (format === 'openai') {
      return new OpenAIMessageConverter() as IMessageConverter<InputParamsMap[T]>
    }
    if (format === 'openai-responses') {
      return new OpenAIResponsesMessageConverter() as IMessageConverter<InputParamsMap[T]>
    }
    return new AnthropicMessageConverter({
      googleReasoningCache: options.googleReasoningCache,
      openRouterReasoningCache: options.openRouterReasoningCache
    }) as IMessageConverter<InputParamsMap[T]>
  }

  /**
   * Check if a format is supported
   */
  static supportsFormat(format: string): format is InputFormat {
    return format === 'openai' || format === 'anthropic' || format === 'openai-responses'
  }

  /**
   * Get list of all supported formats
   */
  static getSupportedFormats(): InputFormat[] {
    return ['openai', 'anthropic', 'openai-responses']
  }
}

export default MessageConverterFactory
