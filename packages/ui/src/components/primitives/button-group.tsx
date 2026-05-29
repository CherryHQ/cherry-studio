import { Separator } from '@cherrystudio/ui/components/primitives/separator'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

const buttonGroupVariants = cva(
  "flex w-fit items-stretch has-[>[data-slot=button-group]]:gap-2 *:focus-visible:relative *:focus-visible:z-10 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-md [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1 [&>[data-slot=button-group-item]>[data-slot=button][data-variant=default]]:bg-primary/10 [&>[data-slot=button-group-item]>[data-slot=button][data-variant=default]]:text-primary [&>[data-slot=button-group-item]>[data-slot=button][data-variant=default]]:shadow-[inset_0_0_0_1px_var(--color-primary)]/20 [&>[data-slot=button-group-item]>[data-slot=button][data-variant=default]]:hover:bg-primary/15 [&>[data-slot=button][data-variant=default]]:bg-primary/10 [&>[data-slot=button][data-variant=default]]:text-primary [&>[data-slot=button][data-variant=default]]:shadow-[inset_0_0_0_1px_var(--color-primary)]/20 [&>[data-slot=button][data-variant=default]]:hover:bg-primary/15",
  {
    variants: {
      orientation: {
        horizontal: '',
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
        className:
          '[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none [&>[data-slot=button-group-item]:not(:first-child)>:is([data-slot=button],[data-slot=input],[data-slot=select-trigger])]:rounded-l-none [&>[data-slot=button-group-item]:not(:first-child)>:is([data-slot=button],[data-slot=input],[data-slot=select-trigger])]:border-l-0 [&>[data-slot=button-group-item]:not(:last-child)>:is([data-slot=button],[data-slot=input],[data-slot=select-trigger])]:rounded-r-none'
      },
      {
        orientation: 'vertical',
        attached: true,
        className:
          'flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none [&>[data-slot=button-group-item]:not(:first-child)>:is([data-slot=button],[data-slot=input],[data-slot=select-trigger])]:rounded-t-none [&>[data-slot=button-group-item]:not(:first-child)>:is([data-slot=button],[data-slot=input],[data-slot=select-trigger])]:border-t-0 [&>[data-slot=button-group-item]:not(:last-child)>:is([data-slot=button],[data-slot=input],[data-slot=select-trigger])]:rounded-b-none'
      }
    ],
    defaultVariants: {
      orientation: 'horizontal',
      attached: true
    }
  }
)

function ButtonGroup({
  className,
  orientation,
  attached,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      data-attached={attached}
      className={cn(buttonGroupVariants({ orientation, attached }), className)}
      {...props}
    />
  )
}

function ButtonGroupItem({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="button-group-item" className={cn('relative flex min-w-0', className)} {...props} />
}

function ButtonGroupText({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot : 'div'

  return (
    <Comp
      className={cn(
        "flex items-center gap-2 rounded-md border bg-muted px-4 text-sm font-medium shadow-xs [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function ButtonGroupSeparator({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      className={cn('relative m-0! self-stretch bg-input data-[orientation=vertical]:h-auto', className)}
      {...props}
    />
  )
}

export { ButtonGroup, ButtonGroupItem, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants }
