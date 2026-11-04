import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  TransitionEvent as ReactTransitionEvent
} from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import type { useTimer } from '@renderer/hooks/useTimer'

import { useComposerLayerActive } from './ComposerContext'
import { getCompactComposerEditorMinHeight, getComposerEditorMinHeight } from './composerSizing'

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

function clampComposerEditorHeightPx(height: number, minHeight: number, maxHeight: number) {
  return Math.min(maxHeight, Math.max(minHeight, Math.round(height)))
}

function getCollapsedEditorFrameHeightPx(frame: HTMLDivElement, editorMinHeight: number, maxHeight: number) {
  const editorElement = frame.querySelector('.composer-tiptap') as HTMLElement | null
  let contentHeight = frame.scrollHeight || editorMinHeight

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

  return Math.max(editorMinHeight, Math.min(contentHeight, maxHeight))
}

function getComposerEditorContentStyle(
  fontSize: number,
  isExpanded: boolean,
  manualEditorFrameHeight: number | null,
  availableHeight: number,
  compact = false
): ComposerEditorContentStyle {
  const minHeight = compact ? getCompactComposerEditorMinHeight(fontSize) : getComposerEditorMinHeight(fontSize)
  const hasCustomHeight = isExpanded || manualEditorFrameHeight !== null
  const isFixedHeight = compact || hasCustomHeight
  const maxHeight = compact ? minHeight : isExpanded ? availableHeight : (manualEditorFrameHeight ?? availableHeight)

  return {
    height: compact ? minHeight : hasCustomHeight ? '100%' : undefined,
    minHeight,
    '--composer-editor-padding': compact ? '3px 0' : '6px 15px 0',
    '--composer-editor-min-height': `${minHeight}px`,
    '--composer-editor-font-size': `${fontSize}px`,
    '--composer-editor-line-height': '1.4',
    '--composer-editor-max-height': `${maxHeight}px`,
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
  const layerActive = useComposerLayerActive()
  const minHeight = getComposerEditorMinHeight(fontSize)
  const compactMinHeight = getCompactComposerEditorMinHeight(fontSize)
  const [maxHeight, setMaxHeight] = useState(minHeight)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const pendingExpandedRef = useRef<boolean | null>(null)
  const resizeDragRef = useRef({ startClientY: 0, startHeight: 0, collapseExpanded: false })
  const [animatedHeight, setAnimatedHeight] = useState<string | null>(null)
  const [requestedManualHeight, setManualHeight] = useState<number | null>(null)
  const manualHeight = requestedManualHeight === null ? null : Math.min(requestedManualHeight, maxHeight)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame || !layerActive) return
    const stage = frame.closest<HTMLElement>('[data-composer-stage]')
    const surface =
      frame.closest<HTMLElement>('[data-composer-dock-surface]') ??
      frame.closest<HTMLElement>('[data-composer-inputbar]')
    const tabBar = document.querySelector<HTMLElement>('[data-ui~="app.tab-bar"]')

    const measure = () => {
      const stageHeight = stage?.clientHeight ?? window.innerHeight - (tabBar?.getBoundingClientRect().bottom ?? 0)
      if (stageHeight <= 0) return
      const chromeHeight = (surface?.offsetHeight ?? frame.offsetHeight) - frame.offsetHeight
      setMaxHeight(Math.max(minHeight, Math.floor(stageHeight - chromeHeight)))
    }
    measure()
    let measurementFrame: number | null = null
    const observer = new ResizeObserver(() => {
      if (measurementFrame !== null) return
      measurementFrame = window.requestAnimationFrame(() => {
        measurementFrame = null
        measure()
      })
    })
    observer.observe(frame)
    if (stage) observer.observe(stage)
    if (surface) observer.observe(surface)
    if (tabBar) observer.observe(tabBar)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      if (measurementFrame !== null) window.cancelAnimationFrame(measurementFrame)
      window.removeEventListener('resize', measure)
    }
  }, [layerActive, minHeight])

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

    const targetHeight = isExpanded ? maxHeight : getCollapsedEditorFrameHeightPx(frame, minHeight, maxHeight)

    clearAnimationFrame()
    animationFrameRef.current = window.requestAnimationFrame(() => {
      setAnimatedHeight(`${targetHeight}px`)
      animationFrameRef.current = null
    })

    clearAnimatedHeightAfterTransition()
  }, [clearAnimatedHeightAfterTransition, clearAnimationFrame, isExpanded, maxHeight, minHeight])

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
    const targetHeight = getCollapsedEditorFrameHeightPx(frame, minHeight, maxHeight)

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
    maxHeight,
    onExpandedChange
  ])

  const fitContentHeight = useCallback(() => {
    clearAnimationFrame()
    pendingExpandedRef.current = null
    setAnimatedHeight(null)
    setManualHeight(null)
    if (isExpanded) onExpandedChange(false)
  }, [clearAnimationFrame, isExpanded, onExpandedChange])

  const resolvedFrameHeight =
    animatedHeight ?? (isExpanded ? `${maxHeight}px` : manualHeight !== null ? `${manualHeight}px` : undefined)

  const frameStyle = useMemo<CSSProperties>(
    () => ({
      height: resolvedFrameHeight,
      minHeight,
      maxHeight,
      overflow: 'hidden',
      transitionDuration: isResizing ? '0ms' : `${COMPOSER_EDITOR_HEIGHT_TRANSITION_MS}ms`
    }),
    [isResizing, minHeight, maxHeight, resolvedFrameHeight]
  )

  const editorContentStyle = useMemo<ComposerEditorContentStyle>(
    () => getComposerEditorContentStyle(fontSize, isExpanded, manualHeight, maxHeight),
    [fontSize, isExpanded, manualHeight, maxHeight]
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
    () => getComposerEditorContentStyle(fontSize, false, null, maxHeight, true),
    [fontSize, maxHeight]
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
    restoreDefaultHeight,
    fitContentHeight
  }
}
