import Scrollbar from '@renderer/components/Scrollbar'
import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

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
    <Container
      className={className}
      $expandable={expandable}
      $disableHoverButton={isScrolledToEnd}
      onClick={expandable ? handleContainerClick : undefined}>
      <ScrollContent ref={scrollRef} $gap={gap} $isExpanded={isExpanded} $expandable={expandable}>
        {children}
      </ScrollContent>
      {canScroll && !isExpanded && !isScrolledToEnd && (
        <ScrollButton onClick={handleScrollRight} className="scroll-right-button">
          <ChevronRight size={14} />
        </ScrollButton>
      )}
    </Container>
  )
}

const Container = styled.div<{ $expandable?: boolean; $disableHoverButton?: boolean }>`
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  position: relative;
  cursor: ${(props) => (props.$expandable ? 'pointer' : 'default')};

  ${(props) =>
    !props.$disableHoverButton &&
    `
    &:hover {
      .scroll-right-button {
        opacity: 1;
      }
    }
  `}
`

const ScrollContent = styled(Scrollbar)<{
  $gap: string
  $isExpanded?: boolean
  $expandable?: boolean
}>`
  display: flex;
  overflow-x: ${(props) => (props.$expandable && props.$isExpanded ? 'hidden' : 'auto')};
  overflow-y: hidden;
  white-space: ${(props) => (props.$expandable && props.$isExpanded ? 'normal' : 'nowrap')};
  gap: ${(props) => props.$gap};
  flex-wrap: ${(props) => (props.$expandable && props.$isExpanded ? 'wrap' : 'nowrap')};

  &::-webkit-scrollbar {
    display: none;
  }
`

const ScrollButton = styled.div`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  opacity: 0;
  transition: opacity 0.2s ease-in-out;
  cursor: pointer;
  background: var(--color-background);
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 6px 16px 0 rgba(0, 0, 0, 0.08),
    0 3px 6px -4px rgba(0, 0, 0, 0.12),
    0 9px 28px 8px rgba(0, 0, 0, 0.05);
  color: var(--color-text-2);

  &:hover {
    color: var(--color-text);
    background: var(--color-list-item);
  }
`

export default HorizontalScrollContainer
