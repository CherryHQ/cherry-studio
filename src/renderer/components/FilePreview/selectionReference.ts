import type { PreviewSelection } from '@cherrystudio/file-preview/core'
import type { SelectionReference } from '@renderer/types/selectionReference'
import type { AbsoluteFilePath } from '@shared/types/file'

import type { FilePreviewFileMetadata } from './types'

/**
 * Builds a complete SelectionReference from a preview selection, whose excerpt the package has
 * already normalized and truncated. The fileStamp snapshots the metadata the preview loaded with —
 * the stamp marks preview-load time, not selection time, which can only make staleness checks
 * over-report (safe direction), never miss a change.
 */
export function createSelectionReference(input: {
  filePath: AbsoluteFilePath
  selection: PreviewSelection
  metadata: FilePreviewFileMetadata
}): SelectionReference {
  return {
    path: input.filePath,
    anchor: input.selection.anchor,
    excerpt: input.selection.excerpt,
    fileStamp: { size: input.metadata.size, mtimeMs: input.metadata.modifiedAt }
  }
}
