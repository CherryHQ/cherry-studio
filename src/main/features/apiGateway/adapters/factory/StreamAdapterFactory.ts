/**
 * Stream Adapter Factory
 *
 * Factory for creating stream adapters based on output format.
 * Uses a registry pattern for extensibility.
 */

import { AnthropicSseFormatter } from '../formatters/AnthropicSseFormatter'
import { OpenAiResponsesSseFormatter } from '../formatters/OpenAiResponsesSseFormatter'
import { OpenAiSseFormatter } from '../formatters/OpenAiSseFormatter'
import type { ISseFormatter, IStreamAdapter, OutputFormat, StreamAdapterOptions } from '../interfaces'
import { AiSdkToAnthropicSse } from '../stream/AiSdkToAnthropicSse'
import { AiSdkToOpenAiResponsesSse } from '../stream/AiSdkToOpenAiResponsesSse'
import { AiSdkToOpenAiSse } from '../stream/AiSdkToOpenAiSse'

/**
 * Registry entry for adapter and formatter classes
 */
interface RegistryEntry {
  adapterClass: new (options: StreamAdapterOptions) => IStreamAdapter
  formatterClass: new () => ISseFormatter
}

/**
 * Stream Adapter Factory
 *
 * Creates stream adapters and formatters for different output formats.
 *
 * @example
 * ```typescript
 * const adapter = StreamAdapterFactory.createAdapter('anthropic', { model: 'claude-3' })
 * const outputStream = adapter.transform(aiSdkStream)
 *
 * const formatter = StreamAdapterFactory.getFormatter('anthropic')
 * for await (const event of outputStream) {
 *   response.write(formatter.formatEvent(event))
 * }
 * response.write(formatter.formatDone())
 * ```
 */
export class StreamAdapterFactory {
  private static registry = new Map<OutputFormat, RegistryEntry>([
    [
      'anthropic',
      {
        adapterClass: AiSdkToAnthropicSse,
        formatterClass: AnthropicSseFormatter
      }
    ],
    [
      'openai',
      {
        adapterClass: AiSdkToOpenAiSse,
        formatterClass: OpenAiSseFormatter
      }
    ],
    [
      'openai-responses',
      {
        adapterClass: AiSdkToOpenAiResponsesSse,
        formatterClass: OpenAiResponsesSseFormatter
      }
    ]
  ])

  /**
   * Create a stream adapter for the specified output format
   *
   * @param format - The target output format
   * @param options - Adapter options (model, messageId, etc.)
   * @returns A stream adapter instance
   * @throws Error if format is not supported
   */
  static createAdapter(format: OutputFormat, options: StreamAdapterOptions): IStreamAdapter {
    const entry = this.registry.get(format)
    if (!entry) {
      throw new Error(
        `Unsupported output format: ${format}. Supported formats: ${this.getSupportedFormats().join(', ')}`
      )
    }
    return new entry.adapterClass(options)
  }

  /**
   * Get an SSE formatter for the specified output format
   *
   * @param format - The target output format
   * @returns An SSE formatter instance
   * @throws Error if format is not supported
   */
  static getFormatter(format: OutputFormat): ISseFormatter {
    const entry = this.registry.get(format)
    if (!entry) {
      throw new Error(
        `Unsupported output format: ${format}. Supported formats: ${this.getSupportedFormats().join(', ')}`
      )
    }
    return new entry.formatterClass()
  }

  /**
   * Get list of all supported formats
   *
   * @returns Array of supported format names
   */
  static getSupportedFormats(): OutputFormat[] {
    return Array.from(this.registry.keys())
  }
}

export default StreamAdapterFactory
