import type { SelectionReference } from '@renderer/types/selectionReference'
import type { AbsoluteFilePath, PhysicalFileMetadata } from '@shared/types/file'
import type { ComponentType } from 'react'

/** Both fields are what a `SelectionReference.fileStamp` is made of, so a plugin can build one. */
export type FilePreviewFileMetadata = Pick<Extract<PhysicalFileMetadata, { kind: 'file' }>, 'size' | 'modifiedAt'>
export type FilePreviewType = 'artifact' | 'file'

export interface FilePreviewPluginProps {
  filePath: AbsoluteFilePath
  fileName: string
  metadata: FilePreviewFileMetadata
  refreshKey: number
  type?: FilePreviewType
  /**
   * Reports the user's current selection as a structural document anchor
   * (`null` when the selection is cleared). Plugins that own a view → structure
   * inverse mapping call this; plugins without one simply ignore the prop.
   * The host forwards it verbatim — presentation of the reference is the
   * embedding surface's concern, never the plugin's.
   */
  onSelectionReference?: (reference: SelectionReference | null) => void
}

export interface FilePreviewPlugin {
  id: string
  extensions: readonly string[]
  load: () => Promise<{ default: ComponentType<FilePreviewPluginProps> }>
  /**
   * Declares that the preview owns a view → structure inverse mapping and will honour
   * `onSelectionReference`. Hosts read it to decide whether to offer selection capture at all,
   * so a surface never shows a picker for a format that can only ignore it.
   */
  supportsSelectionReference?: boolean
}
