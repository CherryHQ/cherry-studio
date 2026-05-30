import { cn } from '@cherrystudio/ui/lib/utils'
import { throttle } from 'lodash'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface ScrollbarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  ref?: React.Ref<HTMLDivElement | null>
  onScroll?: () => void // Custom onScroll prop for useScrollPosition's handleScroll
}

const Scrollbar: FC<ScrollbarProps> = ({
  ref: passedRef,
  children,
  className,
  onScroll: externalOnScroll,
  style,
  ...htmlProps
}) => {
  const [isScrolling, setIsScrolling] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearScrollingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const handleScroll = useCallback(() => {
    setIsScrolling(true)
    clearScrollingTimeout()
    timeoutRef.current = setTimeout(() => {
      setIsScrolling(false)
      timeoutRef.current = null
    }, 1500)
  }, [clearScrollingTimeout])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const throttledInternalScrollHandler = useCallback(throttle(handleScroll, 100, { leading: true, trailing: true }), [
    handleScroll
  ])

  // Combined scroll handler
  const combinedOnScroll = useCallback(() => {
    throttledInternalScrollHandler()
    if (externalOnScroll) {
      externalOnScroll()
    }
  }, [throttledInternalScrollHandler, externalOnScroll])

  useEffect(() => {
    return () => {
      clearScrollingTimeout()
      throttledInternalScrollHandler.cancel()
    }
  }, [throttledInternalScrollHandler, clearScrollingTimeout])

  return (
    <div
      {...htmlProps} // Pass other HTML attributes
      className={cn(
        'overflow-y-auto [scrollbar-gutter:stable] [&::-webkit-scrollbar-thumb:hover]:bg-[var(--color-scrollbar-thumb-hover)] [&::-webkit-scrollbar-thumb]:transition-[background] [&::-webkit-scrollbar-thumb]:duration-[2000ms]',
        isScrolling
          ? '[&::-webkit-scrollbar-thumb]:bg-[var(--color-scrollbar-thumb)]'
          : '[&::-webkit-scrollbar-thumb]:bg-transparent',
        className
      )}
      data-scrolling={isScrolling ? 'true' : 'false'}
      onScroll={combinedOnScroll} // Use the combined handler
      ref={passedRef}
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
