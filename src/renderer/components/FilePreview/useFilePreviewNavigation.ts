import { createContext, use } from 'react'

import type { AbsoluteFilePath } from '@shared/types/file'

export type FilePreviewFileOpener = (filePath: AbsoluteFilePath) => void | Promise<void>

export interface FilePreviewNavigation {
  workspacePath: AbsoluteFilePath
  openFile: FilePreviewFileOpener
}

export const FilePreviewNavigationContext = createContext<FilePreviewNavigation | null>(null)

export function useOptionalFilePreviewNavigation(): FilePreviewNavigation | null {
  return use(FilePreviewNavigationContext)
}
