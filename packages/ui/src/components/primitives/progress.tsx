import type { ComponentProps } from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

export function Progress({ className, max = 100, ...props }: ComponentProps<'progress'>) {
  return (
    <progress
      data-slot="progress"
      max={max}
      className={cn(
        'block h-1.5 w-full appearance-none overflow-hidden rounded-full bg-primary/10',
        '[&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-primary/10',
        '[&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary',
        '[&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary',
        'motion-safe:indeterminate:animate-pulse',
        className
      )}
      {...props}
    />
  )
}
