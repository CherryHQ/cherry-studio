import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('ScreenshotSelection')

interface SelectionState {
  startX: number
  startY: number
  endX: number
  endY: number
  isDragging: boolean
}

interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

const ScreenshotSelection = () => {
  const [screenshotData, setScreenshotData] = useState<string | null>(null)
  const [selection, setSelection] = useState<SelectionState>({
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    isDragging: false
  })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Listen for screenshot data from main process
  useEffect(() => {
    const handler = (_event: any, data: { screenshotData: string }) => {
      logger.info('Received screenshot data')
      setScreenshotData(data.screenshotData)
    }

    window.electron.ipcRenderer.on(IpcChannel.Screenshot_SelectionWindowReady, handler)

    return () => {
      window.electron.ipcRenderer.removeListener(IpcChannel.Screenshot_SelectionWindowReady, handler)
    }
  }, [])

  // Draw screenshot on canvas when data is received
  useEffect(() => {
    if (!screenshotData || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      // Set canvas size to match window
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight

      // Draw the screenshot
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      logger.info('Screenshot drawn on canvas')
    }
    img.src = screenshotData
  }, [screenshotData])

  const getSelectionRectangle = useCallback((): Rectangle | null => {
    if (!selection.isDragging && selection.endX === 0 && selection.endY === 0) {
      return null
    }

    const x = Math.min(selection.startX, selection.endX)
    const y = Math.min(selection.startY, selection.endY)
    const width = Math.abs(selection.endX - selection.startX)
    const height = Math.abs(selection.endY - selection.startY)

    return { x, y, width, height }
  }, [selection])

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        logger.info('User cancelled selection with ESC')
        window.api.screenshot.cancelSelection()
      } else if (e.key === 'Enter') {
        const rect = getSelectionRectangle()
        if (rect && rect.width >= 10 && rect.height >= 10) {
          logger.info('User confirmed selection with ENTER', rect)
          window.api.screenshot.confirmSelection(rect)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [getSelectionRectangle])

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    setSelection({
      startX: x,
      startY: y,
      endX: x,
      endY: y,
      isDragging: true
    })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selection.isDragging) return

    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    setSelection((prev) => ({
      ...prev,
      endX: x,
      endY: y
    }))
  }

  const handleMouseUp = useCallback(() => {
    if (!selection.isDragging) return

    const rect = getSelectionRectangle()
    if (rect && rect.width >= 10 && rect.height >= 10) {
      logger.info('Selection completed', rect)
      window.api.screenshot.confirmSelection(rect)
    } else {
      // Selection too small, reset
      setSelection((prev) => ({ ...prev, isDragging: false }))
    }
  }, [selection, getSelectionRectangle])

  const rect = getSelectionRectangle()
  const hasValidSelection = rect && rect.width > 0 && rect.height > 0

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 h-full w-full overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ cursor: 'crosshair' }}>
      {/* Canvas with screenshot */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Dark overlay */}
      <div className="pointer-events-none absolute inset-0 bg-black bg-opacity-40">
        {/* Clear area for selection */}
        {hasValidSelection && rect && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: `${rect.x}px`,
              top: `${rect.y}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              backgroundColor: 'transparent',
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
              border: '2px solid #1890ff'
            }}
          />
        )}
      </div>

      {/* Dimension display */}
      {hasValidSelection && rect && (
        <div
          className="pointer-events-none absolute rounded bg-black bg-opacity-75 px-2 py-1 text-sm text-white"
          style={{
            left: `${rect.x + rect.width / 2}px`,
            top: `${rect.y - 30}px`,
            transform: 'translateX(-50%)'
          }}>
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </div>
      )}

      {/* Control hints */}
      <div className="-translate-x-1/2 pointer-events-none absolute bottom-4 left-1/2 transform rounded bg-black bg-opacity-75 px-4 py-2 text-white">
        ESC to cancel | Drag to select | ENTER to confirm
      </div>
    </div>
  )
}

export default ScreenshotSelection
