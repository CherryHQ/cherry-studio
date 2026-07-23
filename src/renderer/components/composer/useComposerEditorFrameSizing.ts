import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import type { useTimer } from '@renderer/hooks/useTimer'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  TransitionEvent as ReactTransitionEvent
} from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT = 'max(220px, 40vh)'
export const COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT = 'max(220px, 50vh)'
export const COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT_CLASS = 'max-h-[max(220px,40vh)]!'
export const COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT_CLASS = 'max-h-[max(220px,50vh)]!'

const COMPOSER_EDITOR_HEIGHT_TRANSITION_MS = 260
const COMPOSER_EDITOR_RESIZE_KEYBOARD_STEP = 16

type ComposerEditorFrameSizingOptions = {
  fontSize: number
  isExpanded: boolean
  onExpandedChange: (expanded: boolean) => void
  focusEditor: () => void
  setTimeoutTimer: ReturnType<typeof useTimer>['setTimeoutTimer']
}

type ComposerEditorContentStyle = CSSProperties & {
  '--composer-editor-padding': string
  '--composer-editor-min-height': string
  '--composer-editor-font-size': string
  '--composer-editor-line-height': string
  '--composer-editor-max-height': string
  '--composer-editor-overflow-y': 'auto' | 'hidden'
  '--composer-editor-height': 'auto' | '100%'
}

const COMPOSER_EDITOR_ELEMENT_STYLE = [
  'max-height: var(--composer-editor-max-height) !important',
  'overflow-y: var(--composer-editor-overflow-y)',
  'height: var(--composer-editor-height)'
].join('; ')

function getComposerEditorMinHeight(fontSize: number) {
  return Math.ceil(fontSize * 1.4 * 2 + 6)
}

function getCompactComposerEditorMinHeight(fontSize: number) {
  return Math.ceil(fontSize * 1.4 + 6)
}

function getViewportRelativeHeightPx(minHeight: number, viewportRatio: number) {
  return Math.max(minHeight, Math.round(window.innerHeight * viewportRatio))
}

function getExpandedEditorFrameHeightPx(editorMinHeight: number) {
  return Math.max(editorMinHeight, getViewportRelativeHeightPx(220, 0.5))
}

function clampComposerEditorHeightPx(height: number, minHeight: number, maxHeight: number) {
  return Math.min(maxHeight, Math.max(minHeight, Math.round(height)))
}

function getCollapsedEditorFrameHeightPx(frame: HTMLDivElement, editorMinHeight: number) {
  const editorElement = frame.querySelector('.composer-tiptap') as HTMLElement | null
  let contentHeight = frame.scrollHeight || editorMinHeight
  const maxCollapsedHeight = getViewportRelativeHeightPx(220, 0.4)

  if (editorElement) {
    const previousHeight = editorElement.style.height
    const previousMaxHeight = editorElement.style.maxHeight

    try {
      editorElement.style.height = 'auto'
      editorElement.style.maxHeight = 'none'
      contentHeight = editorElement.scrollHeight || contentHeight
    } finally {
      editorElement.style.height = previousHeight
      editorElement.style.maxHeight = previousMaxHeight
    }
  }

  return Math.max(editorMinHeight, Math.min(contentHeight, maxCollapsedHeight))
}

function getComposerEditorContentStyle(
  fontSize: number,
  isExpanded: boolean,
  manualEditorFrameHeight: number | null,
  compact = false
): ComposerEditorContentStyle {
  const minHeight = compact ? getCompactComposerEditorMinHeight(fontSize) : getComposerEditorMinHeight(fontSize)
  const hasCustomHeight = isExpanded || manualEditorFrameHeight !== null
  const isFixedHeight = compact || hasCustomHeight
  const maxHeight = compact
    ? `${minHeight}px`
    : isExpanded
      ? COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT
      : manualEditorFrameHeight !== null
        ? `${manualEditorFrameHeight}px`
        : COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT

  return {
    height: compact ? minHeight : hasCustomHeight ? '100%' : undefined,
    minHeight,
    '--composer-editor-padding': compact ? '3px 0' : '6px 44px 0 15px',
    '--composer-editor-min-height': `${minHeight}px`,
    '--composer-editor-font-size': `${fontSize}px`,
    '--composer-editor-line-height': '1.4',
    '--composer-editor-max-height': maxHeight,
    '--composer-editor-overflow-y': compact ? 'hidden' : 'auto',
    '--composer-editor-height': isFixedHeight ? '100%' : 'auto'
  }
}

export function useComposerEditorFrameSizing({
  fontSize,
  isExpanded,
  onExpandedChange,
  focusEditor,
  setTimeoutTimer
}: ComposerEditorFrameSizingOptions) {
  const minHeight = getComposerEditorMinHeight(fontSize)
  const compactMinHeight = getCompactComposerEditorMinHeight(fontSize)
  const maxHeight = getExpandedEditorFrameHeightPx(minHeight)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const pendingExpandedRef = useRef<boolean | null>(null)
  const resizeDragRef = useRef({ startClientY: 0, startHeight: 0, collapseExpanded: false })
  const [animatedHeight, setAnimatedHeight] = useState<string | null>(null)
  const [manualHeight, setManualHeight] = useState<number | null>(null)

  const hasManualHeight = manualHeight !== null
  const hasCustomHeight = isExpanded || hasManualHeight

  const clearAnimationFrame = useCallback(() => {
    if (animationFrameRef.current === null) return
    window.cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = null
  }, [])

  const clearAnimatedHeightAfterTransition = useCallback(() => {
    setTimeoutTimer(
      'composerEditorFrameHeightTransition',
      () => {
        setAnimatedHeight(null)
        pendingExpandedRef.current = null
      },
      COMPOSER_EDITOR_HEIGHT_TRANSITION_MS + 80
    )
  }, [setTimeoutTimer])

  const getCurrentHeight = useCallback(() => {
    const measuredHeight = frameRef.current?.offsetHeight
    if (measuredHeight) return measuredHeight
    if (isExpanded) return maxHeight
    return manualHeight ?? minHeight
  }, [isExpanded, manualHeight, maxHeight, minHeight])

  const setClampedManualHeight = useCallback(
    (height: number) => {
      clearAnimationFrame()
      pendingExpandedRef.current = null
      setAnimatedHeight(null)
      setManualHeight(clampComposerEditorHeightPx(height, minHeight, maxHeight))
    },
    [clearAnimationFrame, maxHeight, minHeight]
  )

  const handleResizeMove = useCallback(
    (moveEvent: MouseEvent) => {
      const dragState = resizeDragRef.current
      if (dragState.collapseExpanded) {
        dragState.collapseExpanded = false
        onExpandedChange(false)
      }

      setClampedManualHeight(dragState.startHeight + dragState.startClientY - moveEvent.clientY)
    },
    [onExpandedChange, setClampedManualHeight]
  )

  const { isResizing, startResizing } = useResizeDrag({
    onMove: handleResizeMove,
    cursor: 'row-resize'
  })

  const startResize = useCallback(
    (event: ReactMouseEvent) => {
      resizeDragRef.current = {
        startClientY: event.clientY,
        startHeight: getCurrentHeight(),
        collapseExpanded: isExpanded
      }
      startResizing(event)
    },
    [getCurrentHeight, isExpanded, startResizing]
  )

  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const currentHeight = getCurrentHeight()
      let nextHeight: number | null = null

      switch (event.key) {
        case 'ArrowUp':
          nextHeight = currentHeight + COMPOSER_EDITOR_RESIZE_KEYBOARD_STEP
          break
        case 'ArrowDown':
          nextHeight = currentHeight - COMPOSER_EDITOR_RESIZE_KEYBOARD_STEP
          break
        case 'Home':
          nextHeight = minHeight
          break
        case 'End':
          nextHeight = maxHeight
          break
      }

      if (nextHeight === null) return

      event.preventDefault()
      if (isExpanded) onExpandedChange(false)
      setClampedManualHeight(nextHeight)
    },
    [getCurrentHeight, isExpanded, maxHeight, minHeight, onExpandedChange, setClampedManualHeight]
  )

  const toggleExpanded = useCallback(
    (nextState?: boolean) => {
      const target = typeof nextState === 'boolean' ? nextState : !isExpanded
      const frame = frameRef.current

      if (frame) {
        clearAnimationFrame()
        setAnimatedHeight(`${frame.offsetHeight || minHeight}px`)
        pendingExpandedRef.current = target
      }

      if (!target) setManualHeight(null)
      onExpandedChange(target)
      focusEditor()
    },
    [clearAnimationFrame, focusEditor, isExpanded, minHeight, onExpandedChange]
  )

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || pendingExpandedRef.current !== isExpanded) return

    const targetHeight = isExpanded
      ? getExpandedEditorFrameHeightPx(minHeight)
      : getCollapsedEditorFrameHeightPx(frame, minHeight)

    clearAnimationFrame()
    animationFrameRef.current = window.requestAnimationFrame(() => {
      setAnimatedHeight(`${targetHeight}px`)
      animationFrameRef.current = null
    })

    clearAnimatedHeightAfterTransition()
  }, [clearAnimatedHeightAfterTransition, clearAnimationFrame, isExpanded, minHeight])

  useEffect(() => clearAnimationFrame, [clearAnimationFrame])

  const handleTransitionEnd = useCallback((event: ReactTransitionEvent<HTMLDivElement>) => {
    if (event.propertyName && event.propertyName !== 'height') return

    setAnimatedHeight(null)
    pendingExpandedRef.current = null
  }, [])

  const restoreDefaultHeight = useCallback(() => {
    const frame = frameRef.current

    clearAnimationFrame()
    pendingExpandedRef.current = null

    if (!frame) {
      setManualHeight(null)
      onExpandedChange(false)
      focusEditor()
      return
    }

    const startHeight = frame.offsetHeight || getCurrentHeight()
    const targetHeight = getCollapsedEditorFrameHeightPx(frame, minHeight)

    setAnimatedHeight(`${startHeight}px`)
    animationFrameRef.current = window.requestAnimationFrame(() => {
      setManualHeight(null)
      onExpandedChange(false)
      setAnimatedHeight(`${targetHeight}px`)
      animationFrameRef.current = null
    })
    clearAnimatedHeightAfterTransition()
    focusEditor()
  }, [
    clearAnimatedHeightAfterTransition,
    clearAnimationFrame,
    focusEditor,
    getCurrentHeight,
    minHeight,
    onExpandedChange
  ])

  const resolvedFrameHeight =
    animatedHeight ??
    (isExpanded ? COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT : manualHeight !== null ? `${manualHeight}px` : undefined)

  const frameStyle = useMemo<CSSProperties>(
    () => ({
      height: resolvedFrameHeight,
      minHeight,
      overflow: 'hidden',
      transitionDuration: isResizing ? '0ms' : `${COMPOSER_EDITOR_HEIGHT_TRANSITION_MS}ms`
    }),
    [isResizing, minHeight, resolvedFrameHeight]
  )

  const editorContentStyle = useMemo<ComposerEditorContentStyle>(
    () => getComposerEditorContentStyle(fontSize, isExpanded, manualHeight),
    [fontSize, isExpanded, manualHeight]
  )
  const compactFrameStyle = useMemo<CSSProperties>(
    () => ({
      height: compactMinHeight,
      minHeight: compactMinHeight,
      overflow: 'hidden',
      transitionDuration: '0ms'
    }),
    [compactMinHeight]
  )
  const compactEditorContentStyle = useMemo<ComposerEditorContentStyle>(
    () => getComposerEditorContentStyle(fontSize, false, null, true),
    [fontSize]
  )

  return {
    frameRef,
    frameStyle,
    compactFrameStyle,
    editorContentStyle,
    compactEditorContentStyle,
    editorElementStyle: COMPOSER_EDITOR_ELEMENT_STYLE,
    minHeight,
    maxHeight,
    resizeHandleValue: isExpanded ? maxHeight : (manualHeight ?? minHeight),
    hasCustomHeight,
    isResizing,
    startResize,
    handleResizeKeyDown,
    handleTransitionEnd,
    toggleExpanded,
    restoreDefaultHeight
  }
}
