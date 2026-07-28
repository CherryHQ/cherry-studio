import type { AbsoluteFilePath } from '@shared/types/file'
import type { ComponentType } from 'react'

export interface FilePreviewPluginProps {
  filePath: AbsoluteFilePath
  fileName: string
  refreshKey: number
}

export interface FilePreviewPlugin {
  id: string
  extensions: readonly string[]
  load: () => Promise<{ default: ComponentType<FilePreviewPluginProps> }>
}
