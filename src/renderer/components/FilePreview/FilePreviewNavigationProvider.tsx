import type { AbsoluteFilePath } from '@shared/types/file'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { type FilePreviewFileOpener, FilePreviewNavigationContext } from './useFilePreviewNavigation'

interface FilePreviewNavigationProviderProps {
  children: ReactNode
  openFile: FilePreviewFileOpener
  workspacePath: AbsoluteFilePath
}

/** Lets an embedded preview route links to another local file through its owning surface. */
export function FilePreviewNavigationProvider({
  children,
  openFile,
  workspacePath
}: FilePreviewNavigationProviderProps) {
  const value = useMemo(() => ({ openFile, workspacePath }), [openFile, workspacePath])
  return <FilePreviewNavigationContext value={value}>{children}</FilePreviewNavigationContext>
}
