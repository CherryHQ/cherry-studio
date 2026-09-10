import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

type InputSize = 'sm' | 'default' | 'lg'

interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  size?: InputSize | number
}

const inputSizeClasses: Record<InputSize, string> = {
  sm: 'h-8 px-2.5 text-xs md:text-xs',
  default: 'h-9 px-3 text-base md:text-sm',
  lg: 'h-10 px-4 text-base'
}

function Input({ className, type, size = 'default', ...props }: InputProps) {
  const semanticSize = typeof size === 'number' ? 'default' : size

  return (
    <input
      type={type}
      size={typeof size === 'number' ? size : undefined}
      data-slot="input"
      data-size={semanticSize}
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input w-full min-w-0 rounded-md border bg-transparent py-1 transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed',
        'focus-visible:border-primary',
        'disabled:opacity-50',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        inputSizeClasses[semanticSize],
        className
      )}
      {...props}
    />
  )
}

export { Input, type InputProps }
