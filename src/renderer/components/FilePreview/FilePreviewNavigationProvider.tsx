import type { ReactNode } from 'react'

import { type FilePreviewFileOpener, FilePreviewNavigationContext } from './useFilePreviewNavigation'

interface FilePreviewNavigationProviderProps {
  children: ReactNode
  openFile: FilePreviewFileOpener
}

/** Lets an embedded preview route links to another local file through its owning surface. */
export function FilePreviewNavigationProvider({ children, openFile }: FilePreviewNavigationProviderProps) {
  return <FilePreviewNavigationContext value={openFile}>{children}</FilePreviewNavigationContext>
}
