import {
  type DocumentAnchor,
  SELECTION_EXCERPT_MAX_LENGTH,
  type SelectionReference
} from '@renderer/types/selectionReference'
import type { AbsoluteFilePath } from '@shared/types/file'

import type { FilePreviewFileMetadata } from './types'

/**
 * The whitespace class this normalization collapses, written out rather than left to `\s`.
 *
 * The two runtimes do not agree on `\s`: JavaScript counts U+FEFF, Python counts U+0085 and
 * U+001C–U+001F, and neither is a superset of the other. Since the office-transform skill compares
 * text normalized on the Python side against text normalized here, "both call `\s`" is not a shared
 * rule — it is two different rules that happen to agree most of the time. Spelling the set out makes
 * the contract something both sides can implement identically.
 */
const SELECTION_WHITESPACE =
  /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u001c-\u001f]+/g

/**
 * The single whitespace-normalization rule shared by every selection producer:
 * NFC-normalize, collapse every whitespace run to one space, trim the ends.
 * `office_patch_copy.py` implements the same rule over the same explicit class.
 */
export function normalizeSelectionText(text: string): string {
  return text.normalize('NFC').replace(SELECTION_WHITESPACE, ' ').trim()
}

/**
 * Builds a complete SelectionReference for a plugin's current selection.
 * The excerpt is normalized and truncated here so producers never have to.
 * The fileStamp snapshots the metadata the preview loaded with — the stamp
 * marks preview-load time, not selection time, which can only make staleness
 * checks over-report (safe direction), never miss a change.
 */
export function createSelectionReference(input: {
  filePath: AbsoluteFilePath
  anchor: DocumentAnchor
  excerpt: string
  metadata: FilePreviewFileMetadata
}): SelectionReference | null {
  // Truncate by code point: `.slice()` counts UTF-16 units and would cut a surrogate pair in half,
  // leaving a lone surrogate that survives zod and JSON but reaches the Python consumer as U+FFFD.
  const normalized = [...normalizeSelectionText(input.excerpt)].slice(0, SELECTION_EXCERPT_MAX_LENGTH).join('')
  // A selection of nothing but whitespace normalizes away entirely. Reporting it would put a quote
  // chip on screen that quotes no text; every producer routes through here, so one check covers all.
  if (normalized.length === 0) return null
  return {
    path: input.filePath,
    anchor: input.anchor,
    excerpt: normalized,
    fileStamp: { size: input.metadata.size, mtimeMs: input.metadata.modifiedAt }
  }
}
