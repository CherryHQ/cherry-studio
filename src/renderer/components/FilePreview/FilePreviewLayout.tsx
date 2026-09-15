import type { ReactNode } from 'react'

import { Scrollbar } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

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

function FilePreviewContent({ children, composerInset = true }: { children: ReactNode; composerInset?: boolean }) {
  return (
    // Themed auto-hiding scrollbar (consistent with the rest of the app) for the text-like
    // previews that scroll here (markdown/text/html source). `scrollbar-gutter:auto` overrides
    // Scrollbar's default `stable` so document-viewer plugins (image/pdf/word/pptx), whose
    // full-height child never overflows Content, don't reserve an empty gutter strip. A maximized
    // pane runs full height under the elevated composer, so the scroll end also needs its height
    // as trailing room to clear it. A plugin whose content paints its own opaque surface passes
    // composerInset={false} and pads inside that surface instead — padding here would show the
    // pane background as a band between the surface and the floating composer.
    <Scrollbar
      data-testid="file-preview-content"
      className={cn('min-h-0 flex-1 [scrollbar-gutter:auto]', composerInset && 'pb-[var(--chat-composer-inset,0px)]')}>
      {children}
    </Scrollbar>
  )
}

export const FilePreviewLayout = {
  Frame: FilePreviewFrame,
  Content: FilePreviewContent
}
