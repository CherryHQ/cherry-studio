import { cn } from '@cherrystudio/ui/lib/utils'
import Scrollbar from '@renderer/components/Scrollbar'
import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * 水平滚动容器
 * @param children 子元素
 * @param dependencies 依赖项
 * @param scrollDistance 滚动距离
 * @param className 类名
 * @param gap 间距
 * @param expandable 是否可展开
 */
export interface HorizontalScrollContainerProps {
  children: React.ReactNode
  dependencies?: readonly unknown[]
  scrollDistance?: number
  className?: string
  classNames?: {
    container?: string
    content?: string
  }
  gap?: string
  expandable?: boolean
}

const HorizontalScrollContainer: React.FC<HorizontalScrollContainerProps> = ({
  children,
  dependencies = [],
  scrollDistance = 200,
  className,
  classNames,
  gap = '8px',
  expandable = false
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isScrolledToEnd, setIsScrolledToEnd] = useState(false)

  const handleScrollRight = (event: React.MouseEvent) => {
    scrollRef.current?.scrollBy({ left: scrollDistance, behavior: 'smooth' })
    event.stopPropagation()
  }

  const handleContainerClick = (e: React.MouseEvent) => {
    if (expandable) {
      // 确保不是点击了其他交互元素（如 tag 的关闭按钮）
      const target = e.target as HTMLElement
      if (!target.closest('[data-no-expand]')) {
        setIsExpanded(!isExpanded)
      }
    }
  }

  const checkScrollability = () => {
    const scrollElement = scrollRef.current
    if (scrollElement) {
      const parentElement = scrollElement.parentElement
      const availableWidth = parentElement ? parentElement.clientWidth : scrollElement.clientWidth

      // 确保容器不会超出可用宽度
      const canScrollValue = scrollElement.scrollWidth > Math.min(availableWidth, scrollElement.clientWidth)
      setCanScroll(canScrollValue)

      // 检查是否滚动到最右侧
      if (canScrollValue) {
        const isAtEnd = Math.abs(scrollElement.scrollLeft + scrollElement.clientWidth - scrollElement.scrollWidth) <= 1
        setIsScrolledToEnd(isAtEnd)
      } else {
        setIsScrolledToEnd(false)
      }
    }
  }

  useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)

  return (
    <div
      className={cn(
        'group/container relative flex min-w-0 max-w-full flex-1 items-center',
        expandable ? 'cursor-pointer' : 'cursor-default',
        className,
        classNames?.container
      )}
      onClick={expandable ? handleContainerClick : undefined}>
      <Scrollbar
        ref={scrollRef}
        className={cn('flex min-w-0 flex-1 overflow-y-hidden', classNames?.content)}
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
          onClick={handleScrollRight}
          className={cn(
            'scroll-right-button -translate-y-1/2 absolute top-1/2 right-2 z-[1] flex size-6 cursor-pointer items-center justify-center rounded-full bg-background opacity-0 shadow-[0_6px_16px_0_rgba(0,0,0,0.08),0_3px_6px_-4px_rgba(0,0,0,0.12),0_9px_28px_8px_rgba(0,0,0,0.05)] transition-opacity hover:bg-accent',
            !isScrolledToEnd && 'group-hover/container:opacity-100'
          )}>
          <ChevronRight size={14} className="text-muted-foreground hover:text-foreground" />
        </div>
      )}
    </div>
  )
}

export default HorizontalScrollContainer
