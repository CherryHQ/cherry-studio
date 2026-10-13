import { type ReactNode, useMemo } from 'react'

import { type MarkdownHost, MarkdownHostContext } from './useMarkdownHost'

interface MarkdownHostProviderProps extends MarkdownHost {
  children: ReactNode
}

export function MarkdownHostProvider({
  children,
  openFilePath,
  openExternalUrl,
  copyRichContent,
  exportTableAsExcel,
  notifySuccess,
  notifyError
}: MarkdownHostProviderProps) {
  const value = useMemo(
    () => ({ openFilePath, openExternalUrl, copyRichContent, exportTableAsExcel, notifySuccess, notifyError }),
    [openFilePath, openExternalUrl, copyRichContent, exportTableAsExcel, notifySuccess, notifyError]
  )
  return <MarkdownHostContext value={value}>{children}</MarkdownHostContext>
}
