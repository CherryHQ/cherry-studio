import Scrollbar from '@renderer/components/Scrollbar'
import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

export interface UseHorizontalScrollProps {
  dependencies: readonly unknown[]
  scrollDistance?: number
}

export const useHorizontalScroll = ({ dependencies, scrollDistance = 200 }: UseHorizontalScrollProps) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = useState(false)

  const handleScrollRight = () => {
    scrollRef.current?.scrollBy({ left: scrollDistance, behavior: 'smooth' })
  }

  const checkScrollability = () => {
    const scrollElement = scrollRef.current
    if (scrollElement) {
      setCanScroll(scrollElement.scrollWidth > scrollElement.clientWidth)
    }
  }

  useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

    checkScrollability()

    const resizeObserver = new ResizeObserver(checkScrollability)
    resizeObserver.observe(scrollElement)

    window.addEventListener('resize', checkScrollability)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', checkScrollability)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)

  const ScrollContainer = styled.div`
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    gap: 6px;
    padding-right: 2rem;
    position: relative;

    -webkit-app-region: drag;

    > * {
      -webkit-app-region: no-drag;
    }

    &:hover {
      .scroll-right-button {
        opacity: 1;
      }
    }
  `

  const ScrollContent = styled(Scrollbar)`
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
    gap: 8px;

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

  const renderScrollButton = () => {
    if (!canScroll) return null

    return (
      <ScrollButton onClick={handleScrollRight} className="scroll-right-button">
        <ChevronRight size={14} />
      </ScrollButton>
    )
  }

  return {
    scrollRef,
    canScroll,
    handleScrollRight,
    ScrollContainer,
    ScrollContent,
    renderScrollButton
  }
}
