import { Scrollbar } from '@cherrystudio/ui'
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
    // Themed auto-hiding scrollbar (consistent with the rest of the app) for the text-like
    // previews that scroll here (markdown/text/html source). `scrollbar-gutter:auto` overrides
    // Scrollbar's default `stable` so document-viewer plugins (image/pdf/word/pptx), whose
    // full-height child never overflows Content, don't reserve an empty gutter strip.
    <Scrollbar data-testid="file-preview-content" className="min-h-0 flex-1 [scrollbar-gutter:auto]">
      {children}
    </Scrollbar>
  )
}

export const FilePreviewLayout = {
  Frame: FilePreviewFrame,
  Content: FilePreviewContent
}
