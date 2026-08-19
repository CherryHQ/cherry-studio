import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

interface InputProps extends React.ComponentProps<'input'> {}

const LTR_INPUT_TYPES = new Set(['email', 'number', 'password', 'tel', 'url'])

function Input({ className, type, dir, ...props }: InputProps) {
  const resolvedDirection = dir ?? (type && LTR_INPUT_TYPES.has(type) ? 'ltr' : 'auto')

  return (
    <input
      type={type}
      dir={resolvedDirection}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed md:text-sm',
        'focus-visible:border-primary',
        'disabled:opacity-50',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        className
      )}
      {...props}
    />
  )
}

export { Input, type InputProps }
