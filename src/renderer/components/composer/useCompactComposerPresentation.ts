import type { RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const COMPOSER_OVERFLOW_TOLERANCE_PX = 1

type CompactComposerPresentationOptions = {
  enabled: boolean
  frameRef: RefObject<HTMLDivElement | null>
  isComposing: () => boolean
}

type CompactMeasurement = {
  presentation: 'compact' | 'regular'
  revision: number
}

export function useCompactComposerPresentation({ enabled, frameRef, isComposing }: CompactComposerPresentationOptions) {
  const [requestedRevision, setRequestedRevision] = useState(0)
  const [measurement, setMeasurement] = useState<CompactMeasurement>({
    presentation: 'compact',
    revision: -1
  })
  const measurementScheduledRef = useRef(false)
  const mountedRef = useRef(true)
  const wasEnabledRef = useRef(enabled)
  // Mirrors the isCompact value the current render actually painted, so the
  // editor ResizeObserver below can tell a width change caused by a
  // presentation flip apart from an external layout change.
  const renderedIsCompactRef = useRef(enabled)

  const requestMeasurement = useCallback(() => {
    if (!enabled || isComposing() || measurementScheduledRef.current) return

    measurementScheduledRef.current = true
    queueMicrotask(() => {
      measurementScheduledRef.current = false
      if (mountedRef.current) {
        setRequestedRevision((revision) => revision + 1)
      }
    })
  }, [enabled, isComposing])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useLayoutEffect(() => {
    if (!enabled) {
      wasEnabledRef.current = false
      return
    }

    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true
      requestMeasurement()
      return
    }

    if (measurement.revision === requestedRevision || isComposing()) return

    const frame = frameRef.current
    const editorElement = frame?.querySelector<HTMLElement>('.composer-tiptap')
    const compactRowElement = frame?.closest<HTMLElement>('[data-composer-compact-row]')
    if (!editorElement || !compactRowElement) return

    const hasExplicitHardBreak = editorElement.querySelector(':scope > p > br:not(.ProseMirror-trailingBreak)') !== null
    const hasEditorOverflow = editorElement.scrollHeight > editorElement.clientHeight + COMPOSER_OVERFLOW_TOLERANCE_PX
    const hasCompactRowOverflow =
      compactRowElement.scrollWidth > compactRowElement.clientWidth + COMPOSER_OVERFLOW_TOLERANCE_PX

    setMeasurement({
      presentation: hasExplicitHardBreak || hasEditorOverflow || hasCompactRowOverflow ? 'regular' : 'compact',
      revision: requestedRevision
    })
  }, [enabled, frameRef, isComposing, measurement.revision, requestMeasurement, requestedRevision])

  useEffect(() => {
    if (!enabled) return

    const frame = frameRef.current
    const inputbarElement = frame?.closest<HTMLElement>('[data-composer-inputbar]')
    if (!frame || !inputbarElement) return

    // Observe the frame rather than `.composer-tiptap`: Tiptap builds the
    // editor in an effect, so that element does not exist yet on a composer
    // that mounts already enabled. Watching the frame catches both the editor's
    // insertion and its later content edits, and the measurement below reruns
    // off the resulting revision bump.
    const mutationObserver = new MutationObserver(() => {
      attachEditorResizeObserver()
      requestMeasurement()
    })
    mutationObserver.observe(frame, {
      characterData: true,
      childList: true,
      subtree: true
    })

    // Focus-driven affordances (the focus shortcut hint leaving the layout
    // while the editor is focused) change the editor's inline size without
    // touching the inputbar's outer width or the content, so neither observer
    // above would notice: text that fit while focused can wrap on blur and get
    // clipped by the fixed-height compact frame. Watch the editor width itself
    // and remeasure on change.
    let observedEditorElement: HTMLElement | null = null
    let lastEditorWidth = 0
    let lastSeenRenderedCompact = true
    let editorResizeObserver: ResizeObserver | null = null
    const composerFrame: HTMLElement = frame

    function attachEditorResizeObserver() {
      if (typeof ResizeObserver === 'undefined') return
      const editorElement = composerFrame.querySelector<HTMLElement>('.composer-tiptap')
      if (!editorElement || editorElement === observedEditorElement) return

      editorResizeObserver?.disconnect()
      observedEditorElement = editorElement
      lastEditorWidth = editorElement.getBoundingClientRect().width
      lastSeenRenderedCompact = renderedIsCompactRef.current
      editorResizeObserver = new ResizeObserver((entries) => {
        const nextEditorWidth = entries[0]?.contentRect.width ?? editorElement.getBoundingClientRect().width
        if (nextEditorWidth === lastEditorWidth) return

        lastEditorWidth = nextEditorWidth
        // A presentation flip (the optimistic compact render while a
        // measurement is pending, or the settled re-render afterwards) changes
        // the editor width on its own. Feeding that echo back into a new
        // measurement would toggle compact and regular forever while the
        // compact content keeps overflowing, so consume it here and only
        // remeasure for width changes that happen in a steady presentation.
        const renderedCompactNow = renderedIsCompactRef.current
        const flipDrivenWidthChange = renderedCompactNow !== lastSeenRenderedCompact
        lastSeenRenderedCompact = renderedCompactNow
        if (flipDrivenWidthChange) return

        requestMeasurement()
      })
      editorResizeObserver.observe(editorElement)
    }
    attachEditorResizeObserver()

    let lastInputbarWidth = inputbarElement.getBoundingClientRect().width
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const nextInputbarWidth = entries[0]?.contentRect.width ?? inputbarElement.getBoundingClientRect().width
            if (nextInputbarWidth === lastInputbarWidth) return

            lastInputbarWidth = nextInputbarWidth
            requestMeasurement()
          })
    resizeObserver?.observe(inputbarElement)

    return () => {
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      editorResizeObserver?.disconnect()
    }
  }, [enabled, frameRef, requestMeasurement])

  const measurementPending = measurement.revision !== requestedRevision
  const isCompact = enabled && (measurementPending || measurement.presentation === 'compact')
  renderedIsCompactRef.current = isCompact

  return {
    isCompact,
    requestMeasurement
  }
}
