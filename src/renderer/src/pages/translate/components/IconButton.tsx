import { cn } from '@renderer/utils'
import type { ButtonHTMLAttributes, Ref } from 'react'

export type IconButtonSize = 'xs' | 'sm' | 'md'
export type IconButtonTone = 'ghost' | 'destructive' | 'star'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>
  size?: IconButtonSize
  tone?: IconButtonTone
  active?: boolean
}

const SIZE_CLASS: Record<IconButtonSize, string> = {
  xs: 'h-4 w-4 rounded',
  sm: 'h-5 w-5 rounded',
  md: 'h-6 w-6 rounded-3xs'
}

const toneClass = (tone: IconButtonTone, active: boolean): string => {
  if (tone === 'destructive') {
    return 'text-foreground-muted hover:bg-accent hover:text-destructive'
  }
  if (tone === 'star') {
    return active ? 'text-amber-500 bg-amber-500/10' : 'text-foreground-muted hover:bg-accent hover:text-amber-500'
  }
  return active ? 'bg-accent text-foreground' : 'text-foreground-muted hover:bg-accent hover:text-foreground'
}

const IconButton = ({ size = 'sm', tone = 'ghost', active = false, className, type, ref, ...rest }: Props) => (
  <button
    ref={ref}
    type={type ?? 'button'}
    className={cn(
      'flex shrink-0 items-center justify-center transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
      'disabled:cursor-not-allowed disabled:opacity-60',
      SIZE_CLASS[size],
      toneClass(tone, active),
      className
    )}
    {...rest}
  />
)

export default IconButton
