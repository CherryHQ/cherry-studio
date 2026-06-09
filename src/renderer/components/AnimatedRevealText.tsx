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
        'animated-reveal-text inline-block max-w-full select-none overflow-hidden text-ellipsis whitespace-nowrap text-center font-semibold text-[32px] leading-[1.15] tracking-normal max-sm:text-[26px]',
        className
      )}>
      {text}
    </span>
  )
}
