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
 * Assistant edits rebuild text parts as one Composer draft, with an anchor chip holding the place
 * of every `reasoning`/tool part between them, so saving moves text only. The edited text becomes
 * the message's new content and its next-turn context; provider-derived metadata (item ids,
 * citations, composer snapshots, thought signatures) is dropped with the old text, and translation
 * parts are derived and removed.
 *
 * Files are the one part kind with no anchor: Composer rebuilds attachments from its own state and
 * re-emits them as a single run directly after the edited text. So every `file` part must already
 * sit exactly there — a file anywhere else (`file → text`, `text → tool → file`) would be moved by
 * a save, and stays non-editable.
 */
export function canEditAssistantMessageParts(parts: CherryMessagePart[]): boolean {
  if (!hasTextParts(parts)) return false

  // Translations are derived and dropped by the same save, so they never displace a file.
  const kept = parts.filter((part) => part.type !== 'data-translation')
  const lastTextIndex = kept.findLastIndex((part) => part.type === 'text')
  return kept
    .flatMap((part, index) => (part.type === 'file' ? [index] : []))
    .every((fileIndex, offset) => fileIndex === lastTextIndex + 1 + offset)
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
