import {
  type DocumentAnchor,
  SELECTION_EXCERPT_MAX_LENGTH,
  type SelectionReference
} from '@renderer/types/selectionReference'
import type { AbsoluteFilePath } from '@shared/types/file'

import type { FilePreviewFileMetadata } from './types'

/**
 * The single whitespace-normalization rule shared by every selection producer.
 * The office-transform skill restates this rule verbatim for its Python-side
 * text comparisons, so producers and consumers must never diverge from it:
 * NFC-normalize, collapse every whitespace run to one space, trim the ends.
 */
export function normalizeSelectionText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
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
}): SelectionReference {
  return {
    path: input.filePath,
    anchor: input.anchor,
    excerpt: normalizeSelectionText(input.excerpt).slice(0, SELECTION_EXCERPT_MAX_LENGTH),
    fileStamp: { size: input.metadata.size, mtimeMs: input.metadata.modifiedAt }
  }
}
