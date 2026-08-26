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
 * Extract concatenated **text-part** content from parts.
 *
 * NOTE: text-only — NOT equivalent to `find.ts` `getMainTextContent`, which was
 * widened to also fold in fenced code (`data-code`), translations
 * (`data-translation`) and error text (`data-error`). Do not swap one for the
 * other in a migration without accounting for that divergence, or code/error/
 * translation would silently drop from export/copy.
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
 * Assistant edits rebuild text/file parts as one Composer draft. The edited text is saved as the
 * message's new content and reused as conversation context in the next turn. All assistant
 * messages with text are editable uniformly — provider-derived metadata (item ids, citations,
 * cache hints, composer snapshots) is dropped with the old text, and translation parts are
 * derived and removed on save.
 */
export function canEditAssistantMessageParts(parts: CherryMessagePart[]): boolean {
  return hasTextParts(parts)
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
