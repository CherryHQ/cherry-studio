import { type ReactNode, useMemo } from 'react'

import { type MarkdownHost, MarkdownHostContext } from './useMarkdownHost'

interface MarkdownHostProviderProps extends MarkdownHost {
  children: ReactNode
}

export function MarkdownHostProvider({ children, openFilePath }: MarkdownHostProviderProps) {
  const value = useMemo(() => ({ openFilePath }), [openFilePath])
  return <MarkdownHostContext value={value}>{children}</MarkdownHostContext>
}
