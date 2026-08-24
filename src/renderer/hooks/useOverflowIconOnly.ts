import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const OVERFLOW_RELEASE_WIDTH_BUFFER = 24

export function useOverflowIconOnly() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const overflowActivationWidthRef = useRef<number | null>(null)
  const iconOnlyRef = useRef(false)
  const skipNextCompactReleaseRef = useRef(false)
  const [iconOnly, setIconOnly] = useState(false)
  const containerRef = useCallback((node: HTMLDivElement | null) => setContainer(node), [])

  const update = useCallback(
    (measuredWidth?: number) => {
      if (!container) return

      const clientWidth = container.clientWidth || measuredWidth || container.getBoundingClientRect().width
      if (clientWidth <= 0) return

      const scrollWidth = container.scrollWidth || clientWidth

      const currentIconOnly = iconOnlyRef.current
      const hasOverflow = scrollWidth > clientWidth + 1

      if (!currentIconOnly && hasOverflow) {
        overflowActivationWidthRef.current = clientWidth
        skipNextCompactReleaseRef.current = true
      }

      if (currentIconOnly && !hasOverflow && skipNextCompactReleaseRef.current) {
        overflowActivationWidthRef.current = Math.max(overflowActivationWidthRef.current ?? clientWidth, clientWidth)
        skipNextCompactReleaseRef.current = false
      }

      const overflowActivationWidth = overflowActivationWidthRef.current
      const shouldKeepOverflowCompact =
        currentIconOnly &&
        overflowActivationWidth != null &&
        clientWidth <= overflowActivationWidth + OVERFLOW_RELEASE_WIDTH_BUFFER
      const nextIconOnly = hasOverflow || shouldKeepOverflowCompact

      if (!nextIconOnly) {
        overflowActivationWidthRef.current = null
        skipNextCompactReleaseRef.current = false
      }

      if (currentIconOnly === nextIconOnly) return

      iconOnlyRef.current = nextIconOnly
      setIconOnly(nextIconOnly)
    },
    [container]
  )

  useLayoutEffect(() => {
    update()
  })

  useEffect(() => {
    if (!container || typeof ResizeObserver === 'undefined') return

    update()

    const observer = new ResizeObserver((entries) => {
      const containerEntry = entries.find((entry) => entry.target === container)
      update(containerEntry?.contentRect.width)
    })
    const observedChildren = new Set<Element>()
    const observeChildren = () => {
      const nextChildren = new Set(Array.from(container.children))
      for (const child of observedChildren) {
        if (!nextChildren.has(child)) {
          observer.unobserve(child)
          observedChildren.delete(child)
        }
      }
      for (const child of nextChildren) {
        if (!observedChildren.has(child)) {
          observer.observe(child)
          observedChildren.add(child)
        }
      }
    }

    observer.observe(container)
    observeChildren()

    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            observeChildren()
            update()
          })
    mutationObserver?.observe(container, { childList: true })

    return () => {
      mutationObserver?.disconnect()
      observer.disconnect()
    }
  }, [container, update])

  return { iconOnly, containerRef }
}
