import { useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import mobileAgent from '@renderer/assets/images/deviceConnections/mobile-agent.png'
import mobileChat from '@renderer/assets/images/deviceConnections/mobile-chat.png'
import mobileImage from '@renderer/assets/images/deviceConnections/mobile-image.png'
import { cn } from '@renderer/utils/style'

const SLIDES = [
  { image: mobileChat, title: 'deviceConnections.showcase.chat' },
  { image: mobileAgent, title: 'deviceConnections.showcase.agent' },
  { image: mobileImage, title: 'deviceConnections.showcase.image' }
] as const

export function MobileAppShowcase() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (reducedMotion || isHovered || isFocused) return
    const timer = setInterval(() => setSelected((current) => (current + 1) % SLIDES.length), 5000)
    return () => clearInterval(timer)
  }, [reducedMotion, isHovered, isFocused])

  return (
    <section
      aria-label={t('deviceConnections.showcase.title')}
      tabIndex={0}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      className="relative h-100 min-w-0 rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset @3xl:h-auto">
      <div className="absolute inset-0" aria-live="off">
        {SLIDES.map((slide, index) => (
          <img
            key={slide.title}
            src={slide.image}
            alt={t(slide.title)}
            aria-hidden={index !== selected}
            width={828}
            height={1800}
            className={cn(
              'absolute inset-0 m-auto h-full w-auto max-w-full rounded-3xl object-contain transition-opacity duration-500 motion-reduce:transition-none',
              index === selected ? 'opacity-100' : 'opacity-0'
            )}
          />
        ))}
      </div>
    </section>
  )
}
