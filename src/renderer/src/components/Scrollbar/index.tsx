import { throttle } from 'lodash'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

export interface ScrollbarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  ref?: React.Ref<HTMLDivElement | null>
  onScroll?: () => void // Custom onScroll prop for useScrollPosition's handleScroll
}

const SCROLLBAR_HOVER_ZONE = 16 // 检测区域稍大一些，提升体验

const Scrollbar: FC<ScrollbarProps> = ({ ref: passedRef, children, onScroll: externalOnScroll, ...htmlProps }) => {
  const [isScrolling, setIsScrolling] = useState(false)
  const [isHoveringScrollbar, setIsHoveringScrollbar] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

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

  // 检测鼠标是否在滚动条区域
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const distanceFromRight = rect.right - e.clientX
    const hasScrollbar = container.scrollHeight > container.clientHeight

    setIsHoveringScrollbar(hasScrollbar && distanceFromRight <= SCROLLBAR_HOVER_ZONE)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsHoveringScrollbar(false)
  }, [])

  useEffect(() => {
    return () => {
      clearScrollingTimeout()
      throttledInternalScrollHandler.cancel()
    }
  }, [throttledInternalScrollHandler, clearScrollingTimeout])

  // 合并 ref
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node
      if (typeof passedRef === 'function') {
        passedRef(node)
      } else if (passedRef && 'current' in passedRef) {
        passedRef.current = node
      }
    },
    [passedRef]
  )

  return (
    <ScrollBarContainer
      {...htmlProps}
      $isScrolling={isScrolling}
      $isHoveringScrollbar={isHoveringScrollbar}
      className={`${htmlProps.className || ''} ${isHoveringScrollbar ? 'scrollbar-hover' : ''}`.trim()}
      onScroll={combinedOnScroll}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      ref={setRefs}>
      {children}
    </ScrollBarContainer>
  )
}

const ScrollBarContainer = styled.div<{ $isScrolling: boolean; $isHoveringScrollbar: boolean }>`
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: var(--scrollbar-width);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: ${(props) => (props.$isScrolling ? 'var(--color-scrollbar-thumb)' : 'transparent')};
    border-radius: var(--scrollbar-thumb-radius);
    &:hover {
      background: var(--color-scrollbar-thumb-hover);
    }
  }

  &.scrollbar-hover {
    &::-webkit-scrollbar {
      width: calc(2 * var(--scrollbar-width));
    }

    &::-webkit-scrollbar-track {
      background: var(--color-background-soft);
      border-left: 1px solid var(--color-border);
    }

    &::-webkit-scrollbar-thumb {
      background: var(--color-scrollbar-thumb);
      background-clip: padding-box;
      border-left: calc(var(--scrollbar-width) / 2) solid transparent;
      &:hover {
        background: var(--color-scrollbar-thumb-hover);
        background-clip: padding-box;
      }
    }
  }
`

Scrollbar.displayName = 'Scrollbar'

export default Scrollbar
