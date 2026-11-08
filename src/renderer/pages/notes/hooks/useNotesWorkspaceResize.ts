import type { MouseEventHandler, SetStateAction } from 'react'
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
  const [pendingWrites, setPendingWrites] = useState(0)
  const requestedWidth = useRef<{ width: number } | null>({ width: savedWidth })
  const dragStart = useRef({ clientX: 0, width: savedWidth })
  const lastWidth = useRef(savedWidth)
  const workspaceWidth = liveWidth ?? savedWidth

  const saveWidth = useCallback(
    async (width: number) => {
      if (width === requestedWidth.current?.width) return
      const request = { width }
      requestedWidth.current = request
      setLiveWidth(width)
      setPendingWrites((pending) => pending + 1)
      try {
        await setStoredWidth(width)
      } catch (error) {
        logger.error('Failed to update notes workspace width', error as Error)
        if (requestedWidth.current === request) {
          requestedWidth.current = null
          toast.error(t('notes.settings.save_failed'))
          setLiveWidth(null)
        }
      } finally {
        setPendingWrites((pending) => pending - 1)
      }
    },
    [setStoredWidth, t]
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
    if (!isResizing && pendingWrites === 0) {
      setLiveWidth(null)
      requestedWidth.current = { width: savedWidth }
    }
  }, [isResizing, pendingWrites, savedWidth])

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
    (target: SetStateAction<number>) => {
      const width = typeof target === 'function' ? target(requestedWidth.current?.width ?? savedWidth) : target
      void saveWidth(clampWidth(width))
    },
    [saveWidth, savedWidth]
  )

  return {
    workspaceWidth,
    isResizing,
    resizeTransitionActive: isResizing || liveWidth !== null,
    onResizeStart,
    onResize
  }
}
