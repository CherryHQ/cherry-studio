import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

const radioGroupItemVariants = cva(
  cn(
    'aspect-square shrink-0 rounded-full border border-input bg-transparent text-primary shadow-none transition-[color,border-color,box-shadow] outline-none',
    'data-[state=checked]:border-2 data-[state=checked]:border-primary',
    'focus-visible:border-primary',
    'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
    'disabled:cursor-not-allowed disabled:opacity-50'
  ),
  {
    variants: {
      size: {
        sm: 'size-3.5',
        md: 'size-4',
        lg: 'size-5'
      }
    },
    defaultVariants: {
      size: 'md'
    }
  }
)

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn('grid gap-3', className)} {...props} />
}

function RadioGroupItem({
  className,
  size = 'md',
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item> & VariantProps<typeof radioGroupItemVariants>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      data-size={size}
      className={cn(radioGroupItemVariants({ size }), className)}
      {...props}>
      <RadioGroupPrimitive.Indicator data-slot="radio-group-indicator" />
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem, radioGroupItemVariants }
