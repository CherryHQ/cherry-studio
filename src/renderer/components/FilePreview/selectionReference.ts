import { normalizeSelectionText } from '@cherrystudio/file-preview/core'
import {
  type DocumentAnchor,
  SELECTION_EXCERPT_MAX_LENGTH,
  type SelectionReference
} from '@renderer/types/selectionReference'
import type { AbsoluteFilePath } from '@shared/types/file'

import type { FilePreviewFileMetadata } from './types'
export { normalizeSelectionText } from '@cherrystudio/file-preview/core'

/**
 * Builds a complete SelectionReference for a plugin's current selection.
 * The excerpt is normalized and truncated here so producers never have to.
 * The fileStamp snapshots the metadata the preview loaded with — the stamp
 * marks preview-load time, not selection time, which can only make staleness
 * checks over-report (safe direction), never miss a change.
 *
 * The excerpt limit counts UTF-16 units, the unit the schema's `.max()` and the spreadsheet scan
 * budget also count. Truncation backs off one unit rather than splitting a surrogate pair: a lone
 * surrogate survives zod and JSON only to reach the Python consumer as U+FFFD.
 */
export function createSelectionReference(input: {
  filePath: AbsoluteFilePath
  anchor: DocumentAnchor
  excerpt: string
  metadata: FilePreviewFileMetadata
}): SelectionReference | null {
  // Back off one unit rather than cut a surrogate pair in half; see the excerpt-limit note above.
  const collapsed = normalizeSelectionText(input.excerpt)
  const end =
    (collapsed.codePointAt(SELECTION_EXCERPT_MAX_LENGTH - 1) ?? 0) > 0xffff
      ? SELECTION_EXCERPT_MAX_LENGTH - 1
      : SELECTION_EXCERPT_MAX_LENGTH
  const normalized = collapsed.slice(0, end)
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
