import type { AbsoluteFilePath } from '@shared/types/file'
import { createContext, use } from 'react'

export type FilePreviewFileOpener = (filePath: AbsoluteFilePath) => void | Promise<void>

export const FilePreviewNavigationContext = createContext<FilePreviewFileOpener | null>(null)

export function useOptionalFilePreviewNavigation(): FilePreviewFileOpener | null {
  return use(FilePreviewNavigationContext)
}
