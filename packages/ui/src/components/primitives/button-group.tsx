import { cn } from '@cherrystudio/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

const buttonGroupVariants = cva('inline-flex', {
  variants: {
    orientation: {
      horizontal: 'flex-row',
      vertical: 'flex-col'
    },
    attached: {
      true: '',
      false: 'gap-2'
    }
  },
  compoundVariants: [
    {
      orientation: 'horizontal',
      attached: true,
      className: cn(
        'items-center',
        '[&>[data-slot=button]:not(:first-child)]:-ml-px',
        '[&>[data-slot=button]:not(:first-child)]:rounded-l-none',
        '[&>[data-slot=button]:not(:last-child)]:rounded-r-none'
      )
    },
    {
      orientation: 'vertical',
      attached: true,
      className: cn(
        'items-stretch',
        '[&>[data-slot=button]:not(:first-child)]:-mt-px',
        '[&>[data-slot=button]:not(:first-child)]:rounded-t-none',
        '[&>[data-slot=button]:not(:last-child)]:rounded-b-none'
      )
    }
  ],
  defaultVariants: {
    orientation: 'horizontal',
    attached: true
  }
})

function ButtonGroup({
  className,
  orientation,
  attached,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      data-slot="button-group"
      role="group"
      className={cn(buttonGroupVariants({ orientation, attached }), className)}
      {...props}
    />
  )
}

export { ButtonGroup, buttonGroupVariants }
