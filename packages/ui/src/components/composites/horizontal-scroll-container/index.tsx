import { ChevronLeft, ChevronRight } from 'lucide-react'
import * as React from 'react'

// Original: src/renderer/components/horizontal-scroll-container/index.tsx
import { cn } from '@cherrystudio/ui/lib/utils'

import { Button } from '../../primitives/button'
import Scrollbar from '../scrollbar'

const SCROLL_POSITION_TOLERANCE = 1

export interface HorizontalScrollContainerProps {
  children: React.ReactNode
  scrollDistance?: number
  scrollLeftLabel: string
  scrollRightLabel: string
  className?: string
  gap?: string
  expandable?: boolean
}

const HorizontalScrollContainer: React.FC<HorizontalScrollContainerProps> = ({
  children,
  scrollDistance = 200,
  scrollLeftLabel,
  scrollRightLabel,
  className,
  gap = '8px',
  expandable = false
}) => {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(false)
  const [isExpanded, setIsExpanded] = React.useState(false)

  const handleScrollLeft = (event: React.MouseEvent) => {
    scrollRef.current?.scrollBy({ left: -scrollDistance, behavior: 'smooth' })
    event.stopPropagation()
  }

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
    setCanScrollLeft(canScrollValue && scrollElement.scrollLeft > SCROLL_POSITION_TOLERANCE)
    setCanScrollRight(
      canScrollValue &&
        scrollElement.scrollLeft + scrollElement.clientWidth < scrollElement.scrollWidth - SCROLL_POSITION_TOLERANCE
    )
  }, [])

  React.useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) {
      return
    }

    const resizeObserver = new ResizeObserver(checkScrollability)
    const observeResizeTargets = () => {
      resizeObserver.disconnect()
      resizeObserver.observe(scrollElement)
      if (scrollElement.parentElement) {
        resizeObserver.observe(scrollElement.parentElement)
      }
      for (const child of scrollElement.children) {
        resizeObserver.observe(child)
      }
    }
    const mutationObserver = new MutationObserver(() => {
      observeResizeTargets()
      checkScrollability()
    })

    observeResizeTargets()
    mutationObserver.observe(scrollElement, { childList: true, subtree: true, characterData: true })
    scrollElement.addEventListener('scroll', checkScrollability, { passive: true })
    checkScrollability()

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      scrollElement.removeEventListener('scroll', checkScrollability)
    }
  }, [checkScrollability])

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
      {canScrollLeft && !isExpanded && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={scrollLeftLabel}
          data-no-expand
          className={cn(
            'scroll-left-button absolute top-1/2 left-2 z-[1] -translate-y-1/2 rounded-full bg-background opacity-0 shadow-md transition-opacity hover:bg-background focus-visible:bg-background',
            'text-muted-foreground hover:text-foreground focus-visible:text-foreground',
            'group-hover/container:opacity-100 focus-visible:opacity-100'
          )}
          onClick={handleScrollLeft}>
          <ChevronLeft className="size-3.5" />
        </Button>
      )}
      {canScrollRight && !isExpanded && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={scrollRightLabel}
          data-no-expand
          className={cn(
            'scroll-right-button absolute top-1/2 right-2 z-[1] -translate-y-1/2 rounded-full bg-background opacity-0 shadow-md transition-opacity hover:bg-background focus-visible:bg-background',
            'text-muted-foreground hover:text-foreground focus-visible:text-foreground',
            'group-hover/container:opacity-100 focus-visible:opacity-100'
          )}
          onClick={handleScrollRight}>
          <ChevronRight className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

export default HorizontalScrollContainer
