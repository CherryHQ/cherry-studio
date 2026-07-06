/**
 * API Server Adapters
 *
 * Converts between AI API formats. External code enters the subsystem through
 * the two factories; the concrete stream adapters, message converters, and SSE
 * formatters they assemble are internal implementation and are not re-exported.
 */

// Factories — the public entry point
export { type InputParamsMap, MessageConverterFactory } from './factory/MessageConverterFactory'
export { StreamAdapterFactory } from './factory/StreamAdapterFactory'

// Public contract interfaces
export type { InputFormat, ISseFormatter, IStreamAdapter, OutputFormat } from './interfaces'
