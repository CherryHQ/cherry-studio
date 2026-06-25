import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const OVERFLOW_RELEASE_WIDTH_BUFFER = 24

export function useComposerBottomToolbarIconOnly() {
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const overflowActivationWidthRef = useRef<number | null>(null)
  const [iconOnly, setIconOnly] = useState(false)

  const update = useCallback((measuredWidth?: number) => {
    const toolbar = toolbarRef.current
    if (!toolbar) return

    const clientWidth = toolbar.clientWidth || measuredWidth || toolbar.getBoundingClientRect().width
    if (clientWidth <= 0) return

    const scrollWidth = toolbar.scrollWidth || clientWidth

    setIconOnly((currentIconOnly) => {
      const hasOverflow = scrollWidth > clientWidth + 1

      if (!currentIconOnly && hasOverflow) {
        overflowActivationWidthRef.current = clientWidth
      }

      const overflowActivationWidth = overflowActivationWidthRef.current
      const shouldKeepOverflowCompact =
        currentIconOnly &&
        overflowActivationWidth != null &&
        clientWidth <= overflowActivationWidth + OVERFLOW_RELEASE_WIDTH_BUFFER
      const nextIconOnly = hasOverflow || shouldKeepOverflowCompact

      if (!nextIconOnly) {
        overflowActivationWidthRef.current = null
      }

      return currentIconOnly === nextIconOnly ? currentIconOnly : nextIconOnly
    })
  }, [])

  useLayoutEffect(() => {
    update()
  })

  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar || typeof ResizeObserver === 'undefined') return

    update()

    const observer = new ResizeObserver(([entry]) => {
      update(entry?.contentRect.width)
    })

    observer.observe(toolbar)

    return () => observer.disconnect()
  }, [update])

  return { iconOnly, toolbarRef }
}
