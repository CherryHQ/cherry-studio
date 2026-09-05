import type { Serializable } from './serializable'

export const CLAUDE_CODE_EXIT_CATEGORIES = [
  'auth',
  'permission',
  'model',
  'quota',
  'rate_limit',
  'network',
  'proxy',
  'server',
  'mcp',
  'unknown'
] as const

export type ClaudeCodeExitCategory = (typeof CLAUDE_CODE_EXIT_CATEGORIES)[number]

const claudeCodeExitCategorySet = new Set<string>(CLAUDE_CODE_EXIT_CATEGORIES)

export function isClaudeCodeExitCategory(value: unknown): value is ClaudeCodeExitCategory {
  return typeof value === 'string' && claudeCodeExitCategorySet.has(value)
}

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
