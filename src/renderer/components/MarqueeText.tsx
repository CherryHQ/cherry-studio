import { cn } from '@renderer/utils/style'
import { type FC, memo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

interface MarqueeTextProps {
  children: ReactNode
  /** Scroll speed in px/s */
  speed?: number
  /** Fixed pause duration per phase in seconds */
  pauseDuration?: number
  className?: string
}

const MarqueeText: FC<MarqueeTextProps> = ({ children, speed = 30, pauseDuration = 0.8, className }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [overflowAmount, setOverflowAmount] = useState(0)

  const checkOverflow = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (container && content) {
      const overflow = content.scrollWidth > container.clientWidth
      setIsOverflowing(overflow)
      setOverflowAmount(overflow ? content.scrollWidth - container.clientWidth : 0)
    }
  }, [])

  useEffect(() => {
    checkOverflow()
    const observer = new ResizeObserver(checkOverflow)
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }
    return () => observer.disconnect()
  }, [checkOverflow, children])

  const shouldAnimate = isOverflowing && isHovered

  useEffect(() => {
    const el = contentRef.current
    if (!shouldAnimate || !el || overflowAmount <= 0) return

    const scrollTime = overflowAmount / speed
    const total = 2 * scrollTime + 3 * pauseDuration

    // Compute keyframe offsets: pause → scroll-right → pause → scroll-left → pause
    const p1 = pauseDuration / total
    const p2 = (pauseDuration + scrollTime) / total
    const p3 = (2 * pauseDuration + scrollTime) / total
    const p4 = (2 * pauseDuration + 2 * scrollTime) / total

    el.style.willChange = 'transform'

    const animation = el.animate(
      [
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: p1 },
        { transform: `translateX(-${overflowAmount}px)`, offset: p2 },
        { transform: `translateX(-${overflowAmount}px)`, offset: p3 },
        { transform: 'translateX(0)', offset: p4 },
        { transform: 'translateX(0)', offset: 1 }
      ],
      {
        duration: total * 1000,
        iterations: Infinity,
        easing: 'linear'
      }
    )

    return () => {
      const currentTransform = getComputedStyle(el).transform
      animation.cancel()
      el.style.willChange = ''

      // Smooth return: if mid-scroll, transition back to origin
      if (currentTransform && currentTransform !== 'none' && currentTransform !== 'matrix(1, 0, 0, 1, 0, 0)') {
        el.style.transform = currentTransform
        el.getBoundingClientRect() // force reflow
        el.style.transition = 'transform 0.3s ease-out'
        el.style.transform = 'translateX(0)'
        const onEnd = () => {
          el.style.transition = ''
          el.style.transform = ''
          el.removeEventListener('transitionend', onEnd)
        }
        el.addEventListener('transitionend', onEnd)
      }
    }
  }, [shouldAnimate, overflowAmount, speed, pauseDuration])

  return (
    <div
      ref={containerRef}
      className={cn('overflow-hidden whitespace-nowrap', className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}>
      <div ref={contentRef} className="inline-block whitespace-nowrap">
        {children}
      </div>
    </div>
  )
}

export default memo(MarqueeText)
