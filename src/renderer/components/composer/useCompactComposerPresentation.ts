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
    const editorElement = frame?.querySelector<HTMLElement>('.composer-tiptap')
    const inputbarElement = frame?.closest<HTMLElement>('[data-composer-inputbar]')
    if (!editorElement || !inputbarElement) return

    const mutationObserver = new MutationObserver(requestMeasurement)
    mutationObserver.observe(editorElement, {
      characterData: true,
      childList: true,
      subtree: true
    })

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
    }
  }, [enabled, frameRef, requestMeasurement])

  const measurementPending = measurement.revision !== requestedRevision

  return {
    isCompact: enabled && (measurementPending || measurement.presentation === 'compact'),
    requestMeasurement
  }
}
