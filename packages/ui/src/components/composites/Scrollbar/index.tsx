// Original: src/renderer/src/components/Scrollbar/index.tsx
import { cn } from '@cherrystudio/ui/lib/utils'
import { throttle } from 'lodash'
import * as React from 'react'

export interface ScrollbarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  onScroll?: () => void
}

const Scrollbar = ({
  ref,
  children,
  className,
  onScroll: externalOnScroll,
  style,
  ...htmlProps
}: ScrollbarProps & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const [isScrolling, setIsScrolling] = React.useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearScrollingTimeout = React.useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const handleScroll = React.useCallback(() => {
    setIsScrolling(true)
    clearScrollingTimeout()
    timeoutRef.current = setTimeout(() => {
      setIsScrolling(false)
      timeoutRef.current = null
    }, 1500)
  }, [clearScrollingTimeout])

  const throttledInternalScrollHandler = React.useMemo(
    () => throttle(handleScroll, 100, { leading: true, trailing: true }),
    [handleScroll]
  )

  const combinedOnScroll = React.useCallback(() => {
    throttledInternalScrollHandler()
    externalOnScroll?.()
  }, [externalOnScroll, throttledInternalScrollHandler])

  React.useEffect(() => {
    return () => {
      clearScrollingTimeout()
      throttledInternalScrollHandler.cancel()
    }
  }, [clearScrollingTimeout, throttledInternalScrollHandler])

  return (
    <div
      {...htmlProps}
      ref={ref}
      className={cn('overflow-y-auto [scrollbar-gutter:stable]', className)}
      data-scrolling={isScrolling ? 'true' : 'false'}
      onScroll={combinedOnScroll}
      style={{
        ...style,
        scrollbarColor: isScrolling ? 'var(--color-scrollbar-thumb) transparent' : 'transparent transparent'
      }}>
      {children}
    </div>
  )
}

Scrollbar.displayName = 'Scrollbar'

export default Scrollbar
