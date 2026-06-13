import { cn } from '@cherrystudio/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

const inputVariants = cva(
  cn(
    'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input w-full min-w-0 rounded-md border bg-transparent transition-[color,box-shadow] outline-none file:inline-flex file:border-0 file:bg-transparent file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'disabled:opacity-50',
    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive'
  ),
  {
    variants: {
      density: {
        default: 'h-9 px-3 py-1 text-base file:h-7 file:text-sm md:text-sm',
        compact: 'h-8 px-2.5 text-sm file:h-6 file:text-xs'
      }
    },
    defaultVariants: {
      density: 'default'
    }
  }
)

interface InputProps extends React.ComponentProps<'input'>, VariantProps<typeof inputVariants> {}

function Input({ className, type, density, ...props }: InputProps) {
  return <input type={type} data-slot="input" className={cn(inputVariants({ density }), className)} {...props} />
}

export { Input, type InputProps, inputVariants }
