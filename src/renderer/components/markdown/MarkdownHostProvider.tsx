import { type ReactNode, useMemo } from 'react'

import { type MarkdownHost, MarkdownHostContext } from './useMarkdownHost'

interface MarkdownHostProviderProps extends MarkdownHost {
  children: ReactNode
}

export function MarkdownHostProvider({
  children,
  resolveImageSrc,
  openFilePath,
  openExternalUrl,
  copyRichContent,
  exportTableAsExcel,
  notifySuccess,
  notifyError
}: MarkdownHostProviderProps) {
  const value = useMemo(
    () => ({
      resolveImageSrc,
      openFilePath,
      openExternalUrl,
      copyRichContent,
      exportTableAsExcel,
      notifySuccess,
      notifyError
    }),
    [resolveImageSrc, openFilePath, openExternalUrl, copyRichContent, exportTableAsExcel, notifySuccess, notifyError]
  )
  return <MarkdownHostContext value={value}>{children}</MarkdownHostContext>
}
