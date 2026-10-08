import type { ReactNode } from 'react'

import { Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

import { usePreviewHost } from './previewContext'

interface FilePreviewFrameProps {
  children: ReactNode
}

function FilePreviewFrame({ children }: FilePreviewFrameProps) {
  return (
    <div
      data-ui="file-preview.view"
      data-file-preview-root=""
      className="file-preview-root flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent text-foreground">
      {children}
    </div>
  )
}

function FilePreviewContent({
  children,
  composerInset = true,
  scrollsInternally = false
}: {
  children: ReactNode
  composerInset?: boolean
  scrollsInternally?: boolean
}) {
  const { options } = usePreviewHost()
  const reserveInset = composerInset && !(scrollsInternally && options?.bottomInset === 'content')
  return (
    // Leave room for a host's floating composer without reserving a scrollbar gutter.
    <Scrollbar
      data-testid="file-preview-content"
      className={cn(
        'min-h-0 flex-1 [scrollbar-gutter:auto]',
        reserveInset && 'pb-[var(--file-preview-bottom-inset,0px)]'
      )}>
      {children}
    </Scrollbar>
  )
}

export const FilePreviewLayout = {
  Frame: FilePreviewFrame,
  Content: FilePreviewContent
}
