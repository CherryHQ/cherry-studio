/**
 * Stream Adapter Factory
 *
 * Factory for creating stream adapters based on output format.
 * Uses a registry pattern for extensibility.
 */

import { AnthropicSSEFormatter } from '../formatters/AnthropicSSEFormatter'
import { OpenAIResponsesSSEFormatter } from '../formatters/OpenAIResponsesSSEFormatter'
import { OpenAISSEFormatter } from '../formatters/OpenAISSEFormatter'
import type { ISSEFormatter, IStreamAdapter, OutputFormat, StreamAdapterOptions } from '../interfaces'
import { AiSdkToAnthropicSSE } from '../stream/AiSdkToAnthropicSSE'
import { AiSdkToOpenAIResponsesSSE } from '../stream/AiSdkToOpenAIResponsesSSE'
import { AiSdkToOpenAISSE } from '../stream/AiSdkToOpenAISSE'

/**
 * Registry entry for adapter and formatter classes
 */
interface RegistryEntry {
  adapterClass: new (options: StreamAdapterOptions) => IStreamAdapter
  formatterClass: new () => ISSEFormatter
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
        adapterClass: AiSdkToAnthropicSSE,
        formatterClass: AnthropicSSEFormatter
      }
    ],
    [
      'openai',
      {
        adapterClass: AiSdkToOpenAISSE,
        formatterClass: OpenAISSEFormatter
      }
    ],
    [
      'openai-responses',
      {
        adapterClass: AiSdkToOpenAIResponsesSSE,
        formatterClass: OpenAIResponsesSSEFormatter
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
  static getFormatter(format: OutputFormat): ISSEFormatter {
    const entry = this.registry.get(format)
    if (!entry) {
      throw new Error(
        `Unsupported output format: ${format}. Supported formats: ${this.getSupportedFormats().join(', ')}`
      )
    }
    return new entry.formatterClass()
  }

  /**
   * Check if a format is supported
   *
   * @param format - The format to check
   * @returns true if the format is supported
   */
  static supportsFormat(format: OutputFormat): boolean {
    return this.registry.has(format)
  }

  /**
   * Get list of all supported formats
   *
   * @returns Array of supported format names
   */
  static getSupportedFormats(): OutputFormat[] {
    return Array.from(this.registry.keys())
  }

  /**
   * Register a new adapter and formatter for a format
   *
   * @param format - The format name
   * @param adapterClass - The adapter class constructor
   * @param formatterClass - The formatter class constructor
   */
  static registerAdapter(
    format: OutputFormat,
    adapterClass: new (options: StreamAdapterOptions) => IStreamAdapter,
    formatterClass: new () => ISSEFormatter
  ): void {
    this.registry.set(format, { adapterClass, formatterClass })
  }
}

export default StreamAdapterFactory
