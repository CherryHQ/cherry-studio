import type { Serializable } from './serializable'

/**
 * Serialized error for storage and rendering.
 *
 * Known dynamic properties (accessed via index signature):
 * - `i18nKey?: string` — When present, `ErrorBlock` uses `error.${i18nKey}` for
 *   translated display instead of `message`. Set by error handlers (e.g. abort,
 *   auth failure). See: ErrorBlock.tsx, ErrorHandlerMiddleware.ts
 * - `providerId?: string` — Provider ID for i18n interpolation in error messages.
 */
export interface SerializedError {
  name: string | null
  message: string | null
  stack: string | null
  [key: string]: Serializable
}
