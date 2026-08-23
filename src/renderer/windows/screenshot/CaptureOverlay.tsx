import { loggerService } from '@logger'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { DetectedWindow, ScreenshotInitData } from '@shared/types/screenshot'
import type { Dispatch, FC, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { AnnotationCanvas } from './components/AnnotationCanvas'
import { CaptureCanvas } from './components/CaptureCanvas'
import { DimensionLabel } from './components/DimensionLabel'
import { Magnifier } from './components/Magnifier'
import { OcrStatusIcon } from './components/OcrStatusIcon'
import { OcrTextOverlay } from './components/OcrTextOverlay'
import { PropertyPanel } from './components/PropertyPanel'
import { SelectionHandles } from './components/SelectionHandles'
import { TextInput } from './components/TextInput'
import { Toolbar } from './components/Toolbar'
import { BORDER_WIDTH } from './constants'
import { useAnnotation } from './hooks/useAnnotation'
import { useMagnifierFocus } from './hooks/useMagnifierFocus'
import { useOcr } from './hooks/useOcr'
import { useTextInput } from './hooks/useTextInput'
import { initialState, overlayReducer } from './reducer'
import type { OverlayAction, OverlayState, SelectionRect } from './types'
import { findWindowAtPoint } from './utils/findWindowAtPoint'
import { generateSelectionPng } from './utils/generateBlob'

const logger = loggerService.withContext('CaptureOverlay')

/**
 * One display's overlay: the frozen capture, the selection machinery, the annotation
 * tools, and the paths that hand the result back to the main process.
 */
const CaptureOverlay: FC = () => {
  const initData = useWindowInitData<ScreenshotInitData>()
  const [imageLoaded, setImageLoaded] = useState(false)
  /** Pushed by main once the enumeration finishes; empty until then, which snaps to the display. */
  const [snapTargets, setSnapTargets] = useState<DetectedWindow[]>([])
  const [mouseInWindow, setMouseInWindow] = useState(true)
  const imageRef = useRef<HTMLImageElement | null>(null)
  /** Held outside the load effect so the session-ended handler can revoke it too. */
  const objectUrlRef = useRef<string | null>(null)
  const annotationCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const readyReportedRef = useRef(false)

  const [state, dispatch] = useReducer(overlayReducer, initialState)
  const annotation = useAnnotation()

  const mediaId = initData?.mediaId
  const imageUrl = initData?.imageUrl
  const { resetAnnotations } = annotation

  // Suppressed while annotating: the text layer would otherwise take the pointer
  // events the annotation tools need.
  const annotationActive = annotation.state.activeTool !== null || annotation.state.annotations.length > 0
  const ocrBounds = state.phase === 'selected' && !annotationActive ? state.selection : null
  const ocr = useOcr(
    mediaId ?? null,
    ocrBounds,
    initData?.display.scaleFactor ?? 1,
    initData?.ocrAvailable ?? false,
    initData?.autoOcr ?? false
  )
  const { resetOcr } = ocr

  // Fetch and decode share one effect so a session change disposes both in a single step;
  // split across two, the previous capture could win its decode race and paint the wrong bitmap.
  useEffect(() => {
    if (!imageUrl) return

    const controller = new AbortController()
    let disposed = false
    let objectUrl: string | null = null

    void (async () => {
      try {
        const response = await fetch(imageUrl, { signal: controller.signal })
        // A 404 / 400 from the protocol handler is a resolved fetch; unchecked, its error
        // body would become the "image" and paint an empty overlay.
        if (!response.ok) throw new Error(`capture fetch failed: ${response.status}`)
        const blob = await response.blob()
        // Cleanup runs synchronously and can land between the awaits — abort has nothing
        // left to cancel there, so a stale effect would paint the previous session's capture.
        if (disposed) return

        // Blob URL, not the custom-scheme URL directly: a cross-origin image taints the canvas,
        // so the picture would look right while Copy and Save silently threw on every export.
        objectUrl = URL.createObjectURL(blob)
        objectUrlRef.current = objectUrl
        const image = new Image()
        image.src = objectUrl
        await image.decode()
        if (disposed) return

        imageRef.current = image
        setImageLoaded(true)
      } catch (error) {
        if (disposed) return
        logger.error('Failed to load the frozen capture', error as Error)
        // Nothing will ever paint here; end the session on the same path Esc takes rather
        // than letting the main-process fallback timer reveal a permanently blank overlay.
        void ipcApi.request('screenshot.cancel')
      }
    })()

    return () => {
      disposed = true // Must precede abort(), which triggers the catch synchronously.
      controller.abort() // Stop a full-screen PNG still in transit, not just its result.
      // Safe once decoded — the bitmap is the image element's, not the URL's.
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrlRef.current = null
    }
  }, [imageUrl])

  /**
   * Release the capture the moment the session ends.
   *
   * Neither the effect above nor the per-session reset below fires on dismiss: a pooled
   * overlay is hidden, not unmounted, and its init data only changes when the NEXT session
   * starts. Without this the decoded image and the canvas backing store — tens of MB per
   * display — stay resident until then or until the pool decays.
   */
  useIpcOn('screenshot.session_ended', () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    imageRef.current = null
    // Also unmounts the overlay body, dropping the annotation canvas and its backing store.
    setImageLoaded(false)
    dispatch({ type: 'RESET' })
    resetAnnotations()
    resetOcr()
  })

  /**
   * Per-session reset for the reuse path.
   *
   * Pooled overlays are never unmounted (that is the whole point of pushing new init
   * data instead of remounting the subtree), so every piece of session state has to be
   * cleared by hand here or the next capture inherits it.
   */
  useEffect(() => {
    if (!mediaId) return
    dispatch({ type: 'RESET' }) // selection + drag state
    resetAnnotations() // shapes, active tool, and the undo/redo history
    imageRef.current = null
    setImageLoaded(false) // nothing may be drawn until the new capture has decoded
    setMouseInWindow(true)
    setSnapTargets([]) // the previous session's targets are stale the moment it ends
    readyReportedRef.current = false
    resetOcr() // result state + the request generation, so no late result lands here
  }, [mediaId, resetAnnotations, resetOcr])

  // Dropping imageLoaded unmounts the whole overlay body, which is what disposes the
  // toolbar's transient state (active panel, measured layout) and the text editor.
  const contentVisible = imageLoaded && !!imageRef.current

  useIpcOn('screenshot.snap_targets', ({ windows }) => setSnapTargets(windows))

  // Another display's overlay took over; drop our selection but keep the capture.
  useIpcOn('screenshot.reset_overlay', () => {
    dispatch({ type: 'RESET' })
    resetAnnotations()
  })

  // The magnifier follows the cursor across displays; entering must also claim the keyboard,
  // since only the cursor's display is focused at reveal and keys would act on the one just left.
  useEffect(() => {
    const handleLeave = () => setMouseInWindow(false)
    const handleEnter = () => {
      setMouseInWindow(true)
      // Not `overlay_active`: that means "took over the interaction" and resets the
      // other overlay's selection, which hovering must not do.
      void ipcApi.request('screenshot.overlay_focus')
    }
    document.addEventListener('pointerleave', handleLeave)
    document.addEventListener('pointerenter', handleEnter)
    return () => {
      document.removeEventListener('pointerleave', handleLeave)
      document.removeEventListener('pointerenter', handleEnter)
    }
  }, [])

  useHotkeys('escape', () => {
    void ipcApi.request('screenshot.cancel')
  })

  /**
   * Main reveals this window on this signal.
   *
   * Fired from the capture canvas's first completed draw, then deferred one frame:
   * `ready-to-show` and even image decode both precede anything being painted, so
   * reporting earlier reveals a blank full-screen window over the user's desktop.
   */
  const handleFirstPaint = useCallback(() => {
    if (!mediaId || readyReportedRef.current) return
    readyReportedRef.current = true
    requestAnimationFrame(() => {
      void ipcApi.request('screenshot.overlay_ready', { mediaId })
    })
  }, [mediaId])

  // Capture phase, not bubble: toolbar, panel, canvas and text editor all stopPropagation on
  // pointerdown, so the active-overlay slot would go unclaimed and another display keep its selection.
  const handlePointerDownCapture = useCallback(() => {
    void ipcApi.request('screenshot.overlay_active')
  }, [])

  const handleExport = useCallback(
    async (action: 'commit' | 'save') => {
      if (!imageRef.current || !state.selection || !initData) return
      try {
        const pngBytes = await generateSelectionPng(
          imageRef.current,
          state.selection,
          initData.display.scaleFactor,
          annotationCanvasRef.current
        )
        await ipcApi.request(action === 'commit' ? 'screenshot.commit' : 'screenshot.save', { pngBytes })
      } catch (error) {
        logger.error('Failed to export the selection', error as Error)
      }
    },
    [state.selection, initData]
  )

  const handleOk = useCallback(() => void handleExport('commit'), [handleExport])
  const handleSave = useCallback(() => void handleExport('save'), [handleExport])
  const handleCancel = useCallback(() => {
    void ipcApi.request('screenshot.cancel')
  }, [])

  if (!initData) return null

  const { display } = initData
  const logicalWidth = display.width / display.scaleFactor
  const logicalHeight = display.height / display.scaleFactor

  return (
    <div
      onPointerDownCapture={handlePointerDownCapture}
      style={{
        // The window is already on screen before the capture decodes; the gate keeps the
        // user from seeing (and clicking through) a half-built overlay.
        opacity: contentVisible ? 1 : 0,
        pointerEvents: contentVisible ? 'auto' : 'none',
        position: 'fixed',
        inset: 0,
        overflow: 'hidden'
      }}>
      {contentVisible && imageRef.current && (
        <OverlayContent
          image={imageRef.current}
          state={state}
          dispatch={dispatch}
          scaleFactor={display.scaleFactor}
          logicalWidth={logicalWidth}
          logicalHeight={logicalHeight}
          mouseInWindow={mouseInWindow}
          windows={snapTargets}
          annotation={annotation}
          annotationCanvasRef={annotationCanvasRef}
          ocr={ocr}
          autoOcr={initData.autoOcr}
          onFirstPaint={handleFirstPaint}
          onOk={handleOk}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
    </div>
  )
}

/** Split out so `image` is a non-null prop rather than a ref the children have to narrow. */
function OverlayContent({
  image,
  state,
  dispatch,
  scaleFactor,
  logicalWidth,
  logicalHeight,
  mouseInWindow,
  windows,
  annotation,
  annotationCanvasRef,
  ocr,
  autoOcr,
  onFirstPaint,
  onOk,
  onSave,
  onCancel
}: {
  image: HTMLImageElement
  state: OverlayState
  dispatch: Dispatch<OverlayAction>
  scaleFactor: number
  logicalWidth: number
  logicalHeight: number
  mouseInWindow: boolean
  windows: DetectedWindow[]
  annotation: ReturnType<typeof useAnnotation>
  annotationCanvasRef: RefObject<HTMLCanvasElement | null>
  ocr: ReturnType<typeof useOcr>
  autoOcr: boolean
  onFirstPaint: () => void
  onOk: () => void
  onSave: () => void
  onCancel: () => void
}) {
  const fullDisplayRect = useMemo<SelectionRect>(
    () => ({ x: 0, y: 0, width: logicalWidth, height: logicalHeight }),
    [logicalWidth, logicalHeight]
  )
  // Falls back to the whole display so clicking empty desktop selects the screen. Never null
  // while idle, so CaptureCanvas cannot decide window-vs-drag on pointerdown — see its handler.
  const highlightRect = useMemo(() => {
    if (state.phase !== 'idle' || !state.pointerPosition) return null
    return findWindowAtPoint(state.pointerPosition.x, state.pointerPosition.y, windows) ?? fullDisplayRect
  }, [state.phase, state.pointerPosition, windows, fullDisplayRect])

  const dimensionRect = state.phase === 'idle' ? highlightRect : state.selection

  // Half a border width, so the handles centre on the border strip drawn outside the
  // selection instead of sitting on the captured pixels.
  const borderOffset = BORDER_WIDTH / (2 * scaleFactor)

  // Nudge the cursor one logical pixel at a time for precise colour picking.
  useHotkeys(
    'up,down,left,right',
    (e) => {
      if (!state.pointerPosition) return
      const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
      const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      const x = Math.max(0, Math.min(logicalWidth - 1, state.pointerPosition.x + dx))
      const y = Math.max(0, Math.min(logicalHeight - 1, state.pointerPosition.y + dy))
      dispatch({ type: 'POINTER_MOVE', x, y })
    },
    { enabled: state.phase === 'idle' && state.pointerPosition !== null, preventDefault: true }
  )

  useHotkeys('mod+z', () => annotation.undo(), {
    enabled: state.phase === 'selected' && annotation.state.annotations.length > 0
  })
  useHotkeys('mod+shift+z', () => annotation.redo(), {
    enabled: state.phase === 'selected' && annotation.state.redoStack.length > 0
  })

  const showMagnifier =
    mouseInWindow &&
    state.pointerPosition !== null &&
    (state.phase === 'idle' || state.phase === 'selecting' || state.phase === 'resizing')

  const magnifierFocus = useMagnifierFocus(state, scaleFactor)

  const { textInputPosition, textInputKey, textFlushRef, handleTextRequest, handleTextConfirm, handleTextCancel } =
    useTextInput(annotation, state.selection, state.phase)

  const [toolbarLayout, setToolbarLayout] = useState<{
    top: number
    height: number
    left: number
    width: number
    below: boolean
  } | null>(null)

  const { activeTool } = annotation.state
  const hasAnnotationTool = activeTool !== null
  const hasAnnotations = hasAnnotationTool || annotation.state.annotations.length > 0
  const settled = state.phase === 'selected' || state.phase === 'moving' || state.phase === 'resizing'

  return (
    <>
      <CaptureCanvas
        image={image}
        state={state}
        dispatch={dispatch}
        logicalWidth={logicalWidth}
        logicalHeight={logicalHeight}
        scaleFactor={scaleFactor}
        highlightRect={highlightRect}
        lockSelection={hasAnnotationTool}
        onFirstPaint={onFirstPaint}
      />

      {dimensionRect && dimensionRect.width > 0 && dimensionRect.height > 0 && (
        <DimensionLabel
          rect={dimensionRect}
          scaleFactor={scaleFactor}
          toolbarRect={
            state.phase === 'selected' && toolbarLayout && !toolbarLayout.below
              ? {
                  top: toolbarLayout.top,
                  height: toolbarLayout.height,
                  left: toolbarLayout.left,
                  width: toolbarLayout.width
                }
              : undefined
          }
        />
      )}

      {state.selection && settled && (
        <SelectionHandles
          selection={{
            x: state.selection.x - borderOffset,
            y: state.selection.y - borderOffset,
            width: state.selection.width + 2 * borderOffset,
            height: state.selection.height + 2 * borderOffset
          }}
          dispatch={dispatch}
          viewportWidth={logicalWidth}
          viewportHeight={logicalHeight}
        />
      )}

      {settled && state.selection && (hasAnnotationTool || annotation.state.annotations.length > 0) && (
        <AnnotationCanvas
          ref={annotationCanvasRef}
          image={image}
          selection={state.selection}
          scaleFactor={scaleFactor}
          activeTool={activeTool}
          annotations={annotation.state.annotations}
          activeDrawing={annotation.state.activeDrawing}
          color={annotation.state.color}
          strokeWidth={annotation.state.strokeWidth}
          interactive={hasAnnotationTool && state.phase === 'selected'}
          onActiveDrawingChange={annotation.setActiveDrawing}
          onCommit={annotation.commitDrawing}
          onTextRequest={handleTextRequest}
        />
      )}

      {state.phase === 'selected' && state.selection && (
        <Toolbar
          selection={state.selection}
          logicalHeight={logicalHeight}
          activeTool={activeTool}
          canUndo={annotation.state.annotations.length > 0}
          canRedo={annotation.state.redoStack.length > 0}
          onToolChange={annotation.toggleTool}
          onUndo={annotation.undo}
          onRedo={annotation.redo}
          onOk={onOk}
          onSave={onSave}
          onCancel={onCancel}
          onLayout={setToolbarLayout}
          ocrSlot={
            // Nothing to say while idle — but the greyed-out annotating state still
            // has to be shown, so it cannot be folded into the status check.
            ocr.status !== 'idle' || hasAnnotations ? (
              <OcrStatusIcon
                status={ocr.status}
                errorMessage={ocr.errorMessage}
                onCopyText={ocr.copyText}
                onTriggerOcr={ocr.triggerOcr}
                disabled={hasAnnotations}
                autoOcr={autoOcr}
              />
            ) : undefined
          }
        />
      )}

      {state.phase === 'selected' && state.selection && hasAnnotationTool && toolbarLayout && (
        <PropertyPanel
          toolbarTop={toolbarLayout.top}
          toolbarHeight={toolbarLayout.height}
          toolbarLeft={toolbarLayout.left}
          toolbarBelow={toolbarLayout.below}
          logicalHeight={logicalHeight}
          activeTool={activeTool}
          color={annotation.state.color}
          strokeWidth={annotation.state.strokeWidth}
          fontSize={annotation.state.fontSize}
          onColorChange={annotation.setColor}
          onStrokeWidthChange={annotation.setStrokeWidth}
          onFontSizeChange={annotation.setFontSize}
        />
      )}

      {textInputPosition && state.selection && (
        <TextInput
          key={textInputKey}
          position={textInputPosition}
          selection={state.selection}
          fontSize={annotation.state.fontSize}
          color={annotation.state.color}
          onConfirm={handleTextConfirm}
          onCancel={handleTextCancel}
          flushRef={textFlushRef}
        />
      )}

      {showMagnifier && state.pointerPosition && (
        <Magnifier
          image={image}
          cursorX={state.pointerPosition.x}
          cursorY={state.pointerPosition.y}
          focusX={magnifierFocus?.focusX}
          focusY={magnifierFocus?.focusY}
          scaleFactor={scaleFactor}
          logicalWidth={logicalWidth}
          logicalHeight={logicalHeight}
          visible
          showHints={state.phase !== 'resizing'}
          selection={state.selection}
        />
      )}

      {ocr.status === 'done' && state.selection && ocr.lines.length > 0 && (
        <OcrTextOverlay
          bounds={state.selection}
          lines={ocr.lines}
          scaleFactor={scaleFactor}
          interactive={!hasAnnotationTool}
        />
      )}
    </>
  )
}

export default CaptureOverlay
