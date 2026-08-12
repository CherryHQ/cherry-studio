import type { AbsoluteFilePath, PhysicalFileMetadata } from '@shared/types/file'
import type { ComponentType } from 'react'

export type FilePreviewFileMetadata = Pick<Extract<PhysicalFileMetadata, { kind: 'file' }>, 'size'>
export type FilePreviewType = 'artifact' | 'file'

export interface FilePreviewPluginProps {
  filePath: AbsoluteFilePath
  fileName: string
  metadata: FilePreviewFileMetadata
  refreshKey: number
  type?: FilePreviewType
}

export interface FilePreviewPlugin {
  id: string
  extensions: readonly string[]
  load: () => Promise<{ default: ComponentType<FilePreviewPluginProps> }>
}
