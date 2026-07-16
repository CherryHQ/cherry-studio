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
import { readCherryMeta, type TranslationPartData } from '@shared/data/types/uiParts'

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

type TextMessagePart = Extract<CherryMessagePart, { type: 'text' }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Composer rebuilds text parts instead of patching them in place. A valid Cherry composer
 * snapshot on a single text part can be rebuilt from the edited draft, and empty references carry
 * no content. Every other metadata field is opaque state that cannot be safely attached to changed
 * text (for example, Gemini thought signatures), so editing must be rejected instead of dropping it.
 */
function hasUnroundtrippableTextMetadata(part: TextMessagePart, textPartCount: number): boolean {
  const providerMetadata: unknown = part.providerMetadata
  if (providerMetadata === undefined) return false
  if (!isRecord(providerMetadata)) return true
  if (Object.keys(providerMetadata).length === 0) return false
  if (Object.keys(providerMetadata).some((provider) => provider !== 'cherry')) return true

  const cherry = providerMetadata.cherry
  if (!isRecord(cherry)) return cherry !== undefined

  for (const [key, value] of Object.entries(cherry)) {
    if (key === 'references') {
      if (!Array.isArray(value) || value.length > 0) return true
      continue
    }

    if (key === 'composer') {
      if (value !== undefined && (textPartCount !== 1 || !readCherryMeta(part)?.composer)) return true
      continue
    }

    return true
  }

  return false
}

/**
 * Assistant edits rebuild text/file parts as one Composer draft. They are safe only when those
 * editable parts form one contiguous run and already follow the order Composer writes back:
 * text first, then files. Text parts with metadata Composer cannot reproduce are rejected instead
 * of silently losing provider state. Translation parts are derived and removed when the edit is saved.
 */
export function canEditAssistantMessageParts(parts: CherryMessagePart[]): boolean {
  let hasText = false
  let hasEditablePart = false
  let hasFile = false
  let editableRunEnded = false
  const textPartCount = parts.reduce((count, part) => count + (part.type === 'text' ? 1 : 0), 0)

  for (const part of parts) {
    if (part.type === 'data-translation') continue

    if (part.type === 'text') {
      if (editableRunEnded || hasFile || hasUnroundtrippableTextMetadata(part, textPartCount)) return false
      hasText ||= part.text.trim().length > 0
      hasEditablePart = true
      continue
    }

    if (part.type === 'file') {
      if (editableRunEnded) return false
      hasEditablePart = true
      hasFile = true
      continue
    }

    if (hasEditablePart) editableRunEnded = true
  }

  return hasText
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
