import { createContext, use } from 'react'

import type { FileLocation } from '@renderer/types/fileLocation'
import type { AbsoluteFilePath } from '@shared/types/file'

export type FilePreviewFileOpener = (filePath: AbsoluteFilePath, location?: FileLocation) => void | Promise<void>

export interface FilePreviewNavigation {
  workspacePath: AbsoluteFilePath
  openFile: FilePreviewFileOpener
}

export const FilePreviewNavigationContext = createContext<FilePreviewNavigation | null>(null)

export function useOptionalFilePreviewNavigation(): FilePreviewNavigation | null {
  return use(FilePreviewNavigationContext)
}
