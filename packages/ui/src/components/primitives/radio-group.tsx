import { cn } from '@cherrystudio/ui/lib/utils'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

const radioGroupItemVariants = cva(
  cn(
    'relative aspect-square shrink-0 rounded-full border border-[color:var(--color-border-fg-muted)] bg-transparent shadow-none transition-[color,border-color,box-shadow] outline-none',
    'data-[state=checked]:border-control-accent',
    'focus-visible:border-ring focus-visible:ring-ring/35 focus-visible:ring-[1px]',
    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
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

// Center dot — control-accent fill, sized per item so the selected state reads as
// a filled dot (the radix Indicator only renders while checked).
const radioGroupIndicatorVariants = cva('block rounded-full bg-control-accent', {
  variants: {
    size: {
      sm: 'size-1.5',
      md: 'size-2',
      lg: 'size-2.5'
    }
  },
  defaultVariants: {
    size: 'md'
  }
})

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
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="absolute inset-0 flex items-center justify-center">
        <span className={cn(radioGroupIndicatorVariants({ size }))} />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem, radioGroupItemVariants }
