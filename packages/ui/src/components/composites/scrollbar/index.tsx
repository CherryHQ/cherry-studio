import { throttle } from 'es-toolkit/compat'
import * as React from 'react'

// Original: src/renderer/components/scrollbar/index.tsx
import { cn } from '@cherrystudio/ui/lib/utils'

export interface ScrollbarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  /**
   * Hide the scrollbar when scrolling stops.
   *
   * @default true
   */
  autoHideScrollbar?: boolean
  onScroll?: () => void
  showOnHover?: boolean
}

const Scrollbar = ({
  ref,
  autoHideScrollbar = true,
  children,
  className,
  onScroll: externalOnScroll,
  style,
  showOnHover = false,
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
  const useHoverVisibility = showOnHover && autoHideScrollbar

  return (
    <div
      {...htmlProps}
      ref={ref}
      className={cn(
        '[scrollbar-gutter:stable] overflow-y-auto',
        useHoverVisibility &&
          '[scrollbar-color:transparent_transparent] hover:[scrollbar-color:var(--scrollbar-thumb-hover)_transparent] data-[scrolling=true]:[scrollbar-color:var(--scrollbar-thumb)_transparent]',
        !useHoverVisibility &&
          '[&::-webkit-scrollbar-thumb]:transition-[background] [&::-webkit-scrollbar-thumb]:duration-[2000ms] [&::-webkit-scrollbar-thumb:hover]:bg-[var(--scrollbar-thumb-hover)]',
        !useHoverVisibility &&
          (isScrollbarVisible
            ? '[&::-webkit-scrollbar-thumb]:bg-[var(--scrollbar-thumb)]'
            : '[&::-webkit-scrollbar-thumb]:bg-transparent'),
        className
      )}
      data-scrolling={isScrolling ? 'true' : 'false'}
      onScroll={combinedOnScroll}
      style={{
        ...style,
        ...(!useHoverVisibility && {
          scrollbarColor: isScrollbarVisible ? 'var(--scrollbar-thumb) transparent' : 'transparent transparent'
        })
      }}>
      {children}
    </div>
  )
}

Scrollbar.displayName = 'Scrollbar'

export default Scrollbar
