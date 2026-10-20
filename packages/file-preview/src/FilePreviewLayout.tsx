import type { ReactNode } from 'react'

import { Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

import { FilePreviewToolbarPortalHost, FilePreviewToolbarPortalProvider } from './FilePreviewToolbar'
import { usePreviewHost } from './previewContext'

interface FilePreviewFrameProps {
  children: ReactNode
}

function FilePreviewFrame({ children }: FilePreviewFrameProps) {
  return (
    <div
      data-ui="file-preview.view"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent text-foreground">
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

function FilePreviewShell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  if (header === undefined) return children

  return (
    <FilePreviewToolbarPortalProvider>
      <FilePreviewFrame>
        <div
          data-testid="file-preview-header"
          className="relative flex h-11 min-h-11 shrink-0 items-center px-3 after:pointer-events-none after:absolute after:right-3 after:bottom-0 after:left-3 after:border-b after:border-border after:content-['']">
          <div className="flex min-w-0 flex-1 items-center gap-2">{header}</div>
          <FilePreviewToolbarPortalHost />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </FilePreviewFrame>
    </FilePreviewToolbarPortalProvider>
  )
}

export const FilePreviewLayout = {
  Frame: FilePreviewFrame,
  Content: FilePreviewContent,
  Shell: FilePreviewShell
}
