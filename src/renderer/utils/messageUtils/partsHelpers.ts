/**
 * Utility functions for reading data directly from CherryMessagePart[].
 *
 * These are the parts-native equivalents of find.ts functions (which read from blocks).
 * Components should prefer these when PartsContext is available.
 *
 * Lifecycle: introduced in S6, will become the primary utilities after
 * all components migrate to read parts. find.ts will then be removed.
 */

import type { CherryMessagePart } from '@shared/data/types/message'
import type { TranslationPartData } from '@shared/data/types/uiParts'

/**
 * Extract concatenated text content from parts (equivalent to getMainTextContent).
 */
export function getTextFromParts(parts: CherryMessagePart[]): string {
  return parts
    .filter((p): p is Extract<CherryMessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .filter((t) => t.trim().length > 0)
    .join('\n\n')
}

/**
 * Extract concatenated reasoning/thinking content from parts (equivalent to getThinkingContent).
 */
export function getReasoningFromParts(parts: CherryMessagePart[]): string {
  return parts
    .filter((p): p is Extract<CherryMessagePart, { type: 'reasoning' }> => p.type === 'reasoning')
    .map((p) => p.text)
    .filter((t) => t.trim().length > 0)
    .join('\n\n')
}

/**
 * Check if parts contain any text content (equivalent to findMainTextBlocks().length > 0).
 */
export function hasTextParts(parts: CherryMessagePart[]): boolean {
  return parts.some((p) => p.type === 'text' && p.text.trim().length > 0)
}

/**
 * Check if parts contain any translation data parts.
 * DataUIPart for translation has type: 'data-translation'.
 */
export function hasTranslationParts(parts: CherryMessagePart[]): boolean {
  return parts.some((p) => p.type === 'data-translation')
}

/**
 * Extract translation content from data-translation parts.
 */
export function getTranslationFromParts(parts: CherryMessagePart[]): TranslationPartData[] {
  return parts
    .filter(
      (p): p is { type: 'data-translation'; id?: string; data: TranslationPartData } => p.type === 'data-translation'
    )
    .map((p) => p.data)
}
