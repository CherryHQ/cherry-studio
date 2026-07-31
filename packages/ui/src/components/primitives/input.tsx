import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

type InputSize = 'sm' | 'default' | 'lg'

interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  size?: InputSize
}

const inputSizeClasses: Record<InputSize, string> = {
  sm: 'h-8 px-2.5 text-xs',
  default: 'h-9 px-3 text-sm',
  lg: 'h-10 px-4 text-base'
}

function Input({ className, type, size = 'default', ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground w-full min-w-0 rounded-lg border border-input bg-transparent py-1 transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed',
        'focus-visible:border-ring focus-visible:ring-ring/35 focus-visible:ring-[1px]',
        'disabled:opacity-50',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        inputSizeClasses[size],
        className
      )}
      {...props}
    />
  )
}

export { Input, type InputProps }
