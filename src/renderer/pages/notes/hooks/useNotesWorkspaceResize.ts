import type { MouseEventHandler } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import { toast } from '@renderer/services/toast'

export const MIN_NOTES_WORKSPACE_WIDTH = 200
export const MAX_NOTES_WORKSPACE_WIDTH = 480
export const DEFAULT_NOTES_WORKSPACE_WIDTH = 250

const logger = loggerService.withContext('useNotesWorkspaceResize')
const clampWidth = (width: number) => Math.max(MIN_NOTES_WORKSPACE_WIDTH, Math.min(MAX_NOTES_WORKSPACE_WIDTH, width))

export function useNotesWorkspaceResize() {
  const { t } = useTranslation()
  const [storedWidth, setStoredWidth] = usePreference('feature.notes.workspace_width')
  const savedWidth = clampWidth(storedWidth ?? DEFAULT_NOTES_WORKSPACE_WIDTH)
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const dragStart = useRef({ clientX: 0, width: savedWidth })
  const lastWidth = useRef(savedWidth)
  const workspaceWidth = liveWidth ?? savedWidth

  const saveWidth = useCallback(
    async (width: number) => {
      if (width === savedWidth) return
      setIsSaving(true)
      try {
        await setStoredWidth(width)
      } catch (error) {
        logger.error('Failed to update notes workspace width', error as Error)
        toast.error(t('notes.settings.save_failed'))
        setLiveWidth(null)
      } finally {
        setIsSaving(false)
      }
    },
    [savedWidth, setStoredWidth, t]
  )

  const { isResizing, startResizing } = useResizeDrag({
    onMove: (event) => {
      lastWidth.current = clampWidth(dragStart.current.width + event.clientX - dragStart.current.clientX)
      setLiveWidth(lastWidth.current)
    },
    onEnd: () => {
      setLiveWidth(lastWidth.current)
      void saveWidth(lastWidth.current)
    }
  })

  useEffect(() => {
    // Keep the final target's zero-duration transition through its render before releasing the preview.
    if (!isResizing && !isSaving) setLiveWidth(null)
  }, [isResizing, isSaving])

  const onResizeStart = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (event.button !== 0) return
      dragStart.current = { clientX: event.clientX, width: workspaceWidth }
      lastWidth.current = workspaceWidth
      startResizing(event)
    },
    [startResizing, workspaceWidth]
  )

  const onResize = useCallback(
    (requestedWidth: number) => {
      void saveWidth(clampWidth(requestedWidth))
    },
    [saveWidth]
  )

  return {
    workspaceWidth,
    isResizing,
    resizeTransitionActive: isResizing || liveWidth !== null,
    onResizeStart,
    onResize
  }
}
