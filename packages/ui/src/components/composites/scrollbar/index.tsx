// Original: src/renderer/components/scrollbar/index.tsx
import { cn } from '@cherrystudio/ui/lib/utils'
import { throttle } from 'es-toolkit/compat'
import * as React from 'react'

export interface ScrollbarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  /**
   * Hide the scrollbar when scrolling stops.
   *
   * @default true
   */
  autoHideScrollbar?: boolean
  onScroll?: () => void
}

const Scrollbar = ({
  ref,
  autoHideScrollbar = true,
  children,
  className,
  onScroll: externalOnScroll,
  style,
  ...htmlProps
}: ScrollbarProps & { ref?: React.Ref<HTMLDivElement> }) => {
  const [isScrolling, setIsScrolling] = React.useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearScrollingTimeout = React.useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const handleScroll = React.useCallback(() => {
    if (!autoHideScrollbar) return

    setIsScrolling(true)
    clearScrollingTimeout()
    timeoutRef.current = setTimeout(() => {
      setIsScrolling(false)
      timeoutRef.current = null
    }, 1500)
  }, [autoHideScrollbar, clearScrollingTimeout])

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

  const isScrollbarVisible = !autoHideScrollbar || isScrolling

  return (
    <div
      {...htmlProps}
      ref={ref}
      className={cn(
        'overflow-y-auto [scrollbar-gutter:stable] [&::-webkit-scrollbar-thumb:hover]:bg-[var(--scrollbar-thumb-hover)] [&::-webkit-scrollbar-thumb]:transition-[background] [&::-webkit-scrollbar-thumb]:duration-[2000ms]',
        isScrollbarVisible
          ? '[&::-webkit-scrollbar-thumb]:bg-[var(--scrollbar-thumb)]'
          : '[&::-webkit-scrollbar-thumb]:bg-transparent',
        className
      )}
      data-scrolling={isScrolling ? 'true' : 'false'}
      onScroll={combinedOnScroll}
      style={{
        ...style,
        scrollbarColor: isScrollbarVisible ? 'var(--scrollbar-thumb) transparent' : 'transparent transparent'
      }}>
      {children}
    </div>
  )
}

Scrollbar.displayName = 'Scrollbar'

export default Scrollbar
