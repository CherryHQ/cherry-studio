// Original: src/renderer/src/components/HorizontalScrollContainer/index.tsx
import { ChevronRight } from 'lucide-react'
import * as React from 'react'

import { cn } from '../../../lib/utils'
import Scrollbar from '../Scrollbar'

export interface HorizontalScrollContainerProps {
  children: React.ReactNode
  dependencies?: readonly unknown[]
  scrollDistance?: number
  className?: string
  gap?: string
  expandable?: boolean
}

const HorizontalScrollContainer: React.FC<HorizontalScrollContainerProps> = ({
  children,
  dependencies = [],
  scrollDistance = 200,
  className,
  gap = '8px',
  expandable = false
}) => {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = React.useState(false)
  const [isExpanded, setIsExpanded] = React.useState(false)
  const [isScrolledToEnd, setIsScrolledToEnd] = React.useState(false)

  const handleScrollRight = (event: React.MouseEvent) => {
    scrollRef.current?.scrollBy({ left: scrollDistance, behavior: 'smooth' })
    event.stopPropagation()
  }

  const handleContainerClick = (event: React.MouseEvent) => {
    if (!expandable) {
      return
    }

    const target = event.target as HTMLElement
    if (!target.closest('[data-no-expand]')) {
      setIsExpanded((value) => !value)
    }
  }

  const checkScrollability = React.useCallback(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) {
      return
    }

    const parentElement = scrollElement.parentElement
    const availableWidth = parentElement ? parentElement.clientWidth : scrollElement.clientWidth
    const canScrollValue = scrollElement.scrollWidth > Math.min(availableWidth, scrollElement.clientWidth)
    setCanScroll(canScrollValue)

    if (canScrollValue) {
      const isAtEnd = Math.abs(scrollElement.scrollLeft + scrollElement.clientWidth - scrollElement.scrollWidth) <= 1
      setIsScrolledToEnd(isAtEnd)
    } else {
      setIsScrolledToEnd(false)
    }
  }, [])

  React.useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) {
      return
    }

    checkScrollability()

    const handleScroll = () => {
      checkScrollability()
    }

    const resizeObserver = new ResizeObserver(checkScrollability)
    resizeObserver.observe(scrollElement)

    scrollElement.addEventListener('scroll', handleScroll)
    window.addEventListener('resize', checkScrollability)

    return () => {
      resizeObserver.disconnect()
      scrollElement.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', checkScrollability)
    }
  }, [checkScrollability, dependencies])

  return (
    <div
      className={cn(
        'group/container relative flex max-w-full min-w-0 flex-1 items-center',
        expandable ? 'cursor-pointer' : 'cursor-default',
        className
      )}
      onClick={expandable ? handleContainerClick : undefined}>
      <Scrollbar
        ref={scrollRef}
        className="flex min-w-0 flex-1 overflow-y-hidden"
        style={{
          gap,
          overflowX: expandable && isExpanded ? 'hidden' : 'auto',
          whiteSpace: expandable && isExpanded ? 'normal' : 'nowrap',
          flexWrap: expandable && isExpanded ? 'wrap' : 'nowrap',
          scrollbarWidth: 'none'
        }}>
        {children}
      </Scrollbar>
      {canScroll && !isExpanded && !isScrolledToEnd && (
        <div
          className={cn(
            'scroll-right-button absolute top-1/2 right-2 z-[1] flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-[var(--color-background)] opacity-0 shadow-[0_6px_16px_0_rgba(0,0,0,0.08),0_3px_6px_-4px_rgba(0,0,0,0.12),0_9px_28px_8px_rgba(0,0,0,0.05)] transition-opacity',
            !isScrolledToEnd && 'group-hover/container:opacity-100'
          )}
          onClick={handleScrollRight}>
          <ChevronRight size={14} className="text-[var(--color-text-2)] hover:text-[var(--color-text)]" />
        </div>
      )}
    </div>
  )
}

export default HorizontalScrollContainer
