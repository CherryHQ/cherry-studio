import { cn } from '@cherrystudio/ui/lib/utils'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { cva, type VariantProps } from 'class-variance-authority'
import { CheckIcon } from 'lucide-react'
import * as React from 'react'

export type CheckedState = CheckboxPrimitive.CheckedState

const checkboxVariants = cva(
  cn(
    'aspect-square shrink-0 rounded-[4px] border transition-all duration-200 ease-out outline-none',
    'border-border bg-transparent',
    'hover:bg-accent/50',
    'hover:scale-[1.03] active:scale-[0.97]',
    'data-[state=checked]:border-foreground data-[state=checked]:text-foreground',
    'data-[state=indeterminate]:border-foreground data-[state=indeterminate]:text-foreground',
    'data-[state=checked]:animate-checkbox-bounce',
    'focus-visible:ring-3 focus-visible:ring-ring/30',
    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
    'disabled:cursor-not-allowed disabled:border-gray-500/10 disabled:bg-background-subtle'
  ),
  {
    variants: {
      size: {
        sm: 'size-4',
        md: 'size-5',
        lg: 'size-6'
      }
    },
    defaultVariants: {
      size: 'md'
    }
  }
)

const checkboxIconVariants = cva('animate-checkbox-icon-in  motion-reduce:animate-none', {
  variants: {
    size: {
      sm: 'size-3',
      md: 'size-3.5',
      lg: 'size-4'
    }
  },
  defaultVariants: {
    size: 'md'
  }
})

function Checkbox({
  className,
  size = 'md',
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & VariantProps<typeof checkboxVariants>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      data-size={size}
      className={cn(checkboxVariants({ size }), className)}
      {...props}>
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center transition-none">
        <CheckIcon strokeWidth={2.5} className={cn(checkboxIconVariants({ size }), 'text-current')} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox, checkboxVariants }
