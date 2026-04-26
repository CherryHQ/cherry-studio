import { useLayoutEffect, useRef, useState } from 'react'

export const useParentContentWidth = <T extends HTMLElement>() => {
  const elementRef = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = elementRef.current
    const resizeTarget = element?.parentElement

    if (!element || !resizeTarget) {
      return
    }

    const updateWidth = (nextWidth: number) => {
      setWidth((current) => (current === nextWidth ? current : nextWidth))
    }

    updateWidth(Math.round(resizeTarget.getBoundingClientRect().width))

    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.round(entries[0]?.contentRect.width ?? 0)
      updateWidth(nextWidth)
    })

    observer.observe(resizeTarget)

    return () => {
      observer.disconnect()
    }
  }, [])

  return { elementRef, width }
}
