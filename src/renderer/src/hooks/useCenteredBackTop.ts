import { RefObject, useEffect, useState } from 'react'

export function useCenteredBackTop<T extends HTMLElement>(containerRef: RefObject<T | null>) {
  const [buttonStyle, setButtonStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updatePosition = () => {
      const rect = container.getBoundingClientRect()
      const left = rect.left + rect.width / 2
      setButtonStyle({
        left: `${left}px`,
        transform: 'translateX(-50%)',
        right: 'auto',
        boxShadow: 'none',
        border: '1px solid var(--color-border)'
      })
    }

    updatePosition() // Initial call

    const observer = new ResizeObserver(updatePosition)
    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [containerRef])

  return buttonStyle
}
