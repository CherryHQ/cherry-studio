import { cn } from '@renderer/utils/style'
import { type CSSProperties, type FC, memo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

type AnimationCSSProperties = CSSProperties & {
  '--scroll-distance'?: string
  '--scroll-bounce-duration'?: string
}

interface MarqueeTextProps {
  children: ReactNode
  /** Scroll speed in px/s */
  speed?: number
  className?: string
}

const MarqueeText: FC<MarqueeTextProps> = ({ children, speed = 30, className }) => {
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
      if (overflow) {
        setOverflowAmount(content.scrollWidth - container.clientWidth)
      }
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
  // Scroll phases (15%→35% and 65%→85%) each occupy 20% of total duration
  // So each scroll direction takes 0.2 * totalDuration seconds
  // We want: overflowAmount / speed = 0.2 * totalDuration
  const animationDuration = overflowAmount / speed / 0.2

  return (
    <div
      ref={containerRef}
      className={cn('overflow-hidden whitespace-nowrap', className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}>
      <div
        ref={contentRef}
        className={cn('inline-block whitespace-nowrap will-change-transform', shouldAnimate && 'animate-scroll-bounce')}
        style={
          shouldAnimate
            ? ({
                '--scroll-distance': `-${overflowAmount}px`,
                '--scroll-bounce-duration': `${animationDuration}s`
              } satisfies AnimationCSSProperties as CSSProperties)
            : undefined
        }>
        {children}
      </div>
    </div>
  )
}

export default memo(MarqueeText)
