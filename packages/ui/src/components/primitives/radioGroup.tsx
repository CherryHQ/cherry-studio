import { cn } from '@cherrystudio/ui/utils/index'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cva, type VariantProps } from 'class-variance-authority'
import { CircleIcon } from 'lucide-react'
import * as React from 'react'

const radioGroupItemVariants = cva(
  cn(
    'aspect-square shrink-0 rounded-full border transition-all outline-none',
    'border-primary text-primary',
    'hover:bg-primary/10',
    'aria-checked:ring-3 aria-checked:ring-primary/20',
    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
    'disabled:cursor-not-allowed disabled:border-gray-500/10 disabled:bg-background-subtle',
    'dark:bg-input/30 shadow-xs'
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
        className="relative flex items-center justify-center">
        <CircleIcon
          className={cn('fill-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-2.5')}
        />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem, radioGroupItemVariants }
