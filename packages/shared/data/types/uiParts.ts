/**
 * Custom DataUIPart schemas for Cherry Studio.
 *
 * These extend AI SDK's UIMessage.parts with application-specific
 * part types that have no built-in equivalent.
 *
 * AI SDK built-in parts used directly:
 * - TextUIPart (main_text → text)
 * - ReasoningUIPart (thinking → reasoning)
 * - ToolUIPart (tool → tool-{name})
 * - FileUIPart (image/file → file)
 *
 * Custom DataUIParts (no AI SDK equivalent):
 * - data-error (error blocks)
 * - data-translation (translation blocks)
 * - data-video (video blocks)
 * - data-compact (compact/summary blocks)
 * - data-code (code blocks)
 */

import type { SerializedError } from '../../types/error'

// ============================================================================
// Custom DataUIPart data shapes
// ============================================================================

/** Error data — replaces ErrorBlock. May carry the full serialized error payload. */
export type ErrorPartData = Partial<SerializedError> & {
  name?: string | null
  message?: string | null
  stack?: string | null
  code?: string
}

/** Translation data — replaces TranslationBlock */
export interface TranslationPartData {
  content: string
  targetLanguage: string
  sourceLanguage?: string
  sourceBlockId?: string
}

/** Video data — replaces VideoBlock */
export interface VideoPartData {
  url?: string
  filePath?: string
}

/** Compact/summary data — replaces CompactBlock */
export interface CompactPartData {
  content: string
  compactedContent: string
}

/** Code data — replaces CodeBlock */
export interface CodePartData {
  content: string
  language: string
}

// ============================================================================
// Cherry DataUIPart type map (for useChat dataPartSchemas)
// ============================================================================

/**
 * All custom DataUIPart types for Cherry Studio.
 * Used with `useChat({ dataPartSchemas })` to enable type-safe custom parts.
 */
export type CherryDataPartTypes = {
  error: ErrorPartData
  translation: TranslationPartData
  video: VideoPartData
  compact: CompactPartData
  code: CodePartData
}

// ============================================================================
// Cherry-specific providerMetadata shape
// ============================================================================

/**
 * Cherry-specific metadata stored in providerMetadata.cherry
 * on TextUIPart and ReasoningUIPart.
 */
export interface CherryProviderMetadata {
  /** Original block creation timestamp */
  createdAt?: number
  /** Updated timestamp */
  updatedAt?: number
  /** Block-level metadata from old schema */
  metadata?: Record<string, unknown>
  /** Block-level error from old schema */
  error?: {
    name?: string
    message: string
    stack?: string
  }
  /** Content references (citations, mentions) — on TextUIPart only */
  references?: unknown[]
  /** Thinking duration in ms — on ReasoningUIPart only */
  thinkingMs?: number
}
