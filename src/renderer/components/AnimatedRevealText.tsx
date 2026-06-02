import { cn } from '@cherrystudio/ui/lib/utils'

interface AnimatedRevealTextProps {
  text: string
  ariaLabel?: string
  className?: string
}

export default function AnimatedRevealText({ text, ariaLabel, className }: AnimatedRevealTextProps) {
  if (!text.trim()) return null

  return (
    <span
      data-slot="animated-reveal-text"
      aria-label={ariaLabel ?? text}
      className={cn(
        'animated-reveal-text inline-grid max-w-full select-none text-center font-semibold text-[32px] leading-[1.15] tracking-normal max-sm:text-[26px]',
        className
      )}>
      <span aria-hidden="true" className="animated-reveal-text__base">
        {text}
      </span>
      <span aria-hidden="true" className="animated-reveal-text__fill">
        {text}
      </span>
    </span>
  )
}
