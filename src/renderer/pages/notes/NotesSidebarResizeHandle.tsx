import type { MouseEventHandler } from 'react'
import { useTranslation } from 'react-i18next'

import { Separator } from '@cherrystudio/ui'

import { MAX_NOTES_WORKSPACE_WIDTH, MIN_NOTES_WORKSPACE_WIDTH } from './hooks/useNotesWorkspaceResize'

type NotesSidebarResizeHandleProps = {
  width: number
  isResizing: boolean
  onResizeStart: MouseEventHandler<HTMLDivElement>
  onResize: (requestedWidth: number) => void
}

export function NotesSidebarResizeHandle({
  width,
  isResizing,
  onResizeStart,
  onResize
}: NotesSidebarResizeHandleProps) {
  const { t } = useTranslation()

  return (
    <Separator
      orientation="vertical"
      decorative={false}
      tabIndex={0}
      aria-label={t('common.resize_panel')}
      aria-valuemin={MIN_NOTES_WORKSPACE_WIDTH}
      aria-valuemax={MAX_NOTES_WORKSPACE_WIDTH}
      aria-valuenow={width}
      aria-controls="notes-workspace"
      data-testid="notes-sidebar-resize-handle"
      data-resizing={isResizing}
      className="group absolute top-0 right-0 z-10 flex cursor-col-resize justify-end bg-transparent outline-none data-[orientation=vertical]:w-3"
      onMouseDown={onResizeStart}
      onKeyDown={(event) => {
        let requestedWidth: number
        switch (event.key) {
          case 'ArrowRight':
            requestedWidth = width + 16
            break
          case 'ArrowLeft':
            requestedWidth = width - 16
            break
          case 'Home':
            requestedWidth = MIN_NOTES_WORKSPACE_WIDTH
            break
          case 'End':
            requestedWidth = MAX_NOTES_WORKSPACE_WIDTH
            break
          default:
            return
        }
        event.preventDefault()
        onResize(requestedWidth)
      }}>
      <div className="h-full w-px bg-transparent group-hover:bg-border-strong group-focus-visible:bg-ring group-data-[resizing=true]:bg-border-strong" />
    </Separator>
  )
}
