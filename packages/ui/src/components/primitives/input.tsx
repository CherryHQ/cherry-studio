import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

interface InputProps extends React.ComponentProps<'input'> {}

const LEFT_TO_RIGHT_INPUT_TYPES = new Set<React.HTMLInputTypeAttribute>(['email', 'number', 'password', 'tel', 'url'])

function getDefaultInputDirection(type?: React.HTMLInputTypeAttribute): React.HTMLAttributes<HTMLInputElement>['dir'] {
  if (!type || type === 'text' || type === 'search') return 'auto'
  if (LEFT_TO_RIGHT_INPUT_TYPES.has(type)) return 'ltr'
  return undefined
}

function Input({ className, type, dir, ...props }: InputProps) {
  return (
    <input
      type={type}
      dir={dir ?? getDefaultInputDirection(type)}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed md:text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:opacity-50',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        className
      )}
      {...props}
    />
  )
}

export { Input, type InputProps }
