import type { ReactNode } from 'react'

interface FilePreviewFrameProps {
  children: ReactNode
}

function FilePreviewFrame({ children }: FilePreviewFrameProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">{children}</div>
  )
}

function FilePreviewContent({ children }: { children: ReactNode }) {
  return (
    <div data-testid="file-preview-content" className="min-h-0 flex-1 overflow-auto">
      {children}
    </div>
  )
}

export const FilePreviewLayout = {
  Frame: FilePreviewFrame,
  Content: FilePreviewContent
}
