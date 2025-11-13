import { cn } from '@cherrystudio/ui/utils/index'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { cva, type VariantProps } from 'class-variance-authority'
import { CheckIcon } from 'lucide-react'
import * as React from 'react'

export type CheckedState = CheckboxPrimitive.CheckedState

const checkboxVariants = cva(
  cn(
    'aspect-square shrink-0 rounded-[4px] border transition-all outline-none',
    'border-primary text-primary',
    'hover:bg-primary/10',
    'data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary',
    'focus-visible:ring-3 focus-visible:ring-primary/20',
    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
    'disabled:cursor-not-allowed disabled:border-gray-500/10 disabled:bg-background-subtle',
    'bg-white/10 shadow-xs'
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

const checkboxIconVariants = cva('dark:text-white', {
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
        <CheckIcon className={checkboxIconVariants({ size })} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox, checkboxVariants }
