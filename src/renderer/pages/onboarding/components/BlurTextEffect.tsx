import { cn } from '@cherrystudio/ui/lib/utils'
import { useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef } from 'react'

interface BlurTextEffectProps {
  children: string
  className?: string
  blur?: number
  delay?: number
  duration?: number
  stagger?: number
  y?: number
}

const BlurTextEffect = ({
  children,
  className,
  blur = 8,
  delay = 0,
  duration = 0.3,
  stagger = 0.015,
  y = 10
}: BlurTextEffectProps) => {
  const reducedMotion = useReducedMotion()
  const containerRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    const chars = Array.from(container.querySelectorAll<HTMLSpanElement>('span.char'))

    if (reducedMotion) {
      chars.forEach((char) => {
        char.style.opacity = ''
        char.style.transform = ''
        char.style.filter = ''
        char.style.willChange = ''
      })
      return
    }

    const animations = chars.map((char, index) => {
      char.style.opacity = '0'
      char.style.transform = `translateY(${y}px)`
      char.style.filter = blur > 0 ? `blur(${blur}px)` : ''
      char.style.willChange = blur > 0 ? 'opacity, transform, filter' : 'opacity, transform'

      const keyframes: Keyframe[] =
        blur > 0
          ? [
              { opacity: 0, transform: `translateY(${y}px)`, filter: `blur(${blur}px)` },
              { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' }
            ]
          : [
              { opacity: 0, transform: `translateY(${y}px)` },
              { opacity: 1, transform: 'translateY(0)' }
            ]

      const animation = char.animate(keyframes, {
        delay: Math.max(0, delay * 1000 + index * stagger * 1000),
        duration: duration * 1000,
        easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        fill: 'forwards'
      })

      animation.onfinish = () => {
        char.style.opacity = ''
        char.style.transform = ''
        char.style.filter = ''
        char.style.willChange = ''
      }

      return animation
    })

    return () => {
      animations.forEach((animation) => animation.cancel())
    }
  }, [blur, children, delay, duration, reducedMotion, stagger, y])

  return (
    <span
      ref={containerRef}
      className={cn('inline-block whitespace-nowrap', className)}
      style={{ fontWeight: 'inherit' }}>
      {children.split('').map((char, index) => (
        <span
          key={`${char}-${index}`}
          className="char inline-block"
          style={{
            fontWeight: 'inherit',
            whiteSpace: 'pre'
          }}>
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </span>
  )
}

export default BlurTextEffect
