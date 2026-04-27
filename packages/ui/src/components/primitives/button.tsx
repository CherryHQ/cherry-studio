import { cn } from '@cherrystudio/ui/lib/utils'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader } from 'lucide-react'
import * as React from 'react'

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md font-medium transition-all',
    'disabled:pointer-events-none disabled:opacity-40',
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 [&_.lucide:not(.lucide-custom)]:text-current outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
    'aria-loading:cursor-progress aria-loading:opacity-40',
    'shadow-xs'
  ),
  {
    variants: {
      variant: {
        default:
          'bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200',
        destructive: 'bg-destructive text-white hover:bg-destructive-hover focus-visible:ring-destructive/20',
        outline: 'border border-border bg-transparent text-foreground hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'text-neutral-900 shadow-none hover:bg-accent hover:text-accent-foreground dark:text-neutral-100',
        link: 'text-neutral-900 underline-offset-4 hover:text-neutral-700 hover:underline dark:text-neutral-100 dark:hover:text-neutral-300'
      },
      size: {
        default: 'min-h-7.5 gap-1.5 px-2.5 text-[13px]',
        sm: 'min-h-7 rounded-md gap-1.5 px-2.5 text-xs',
        lg: 'min-h-9 rounded-md px-4 text-sm',
        icon: 'size-9',
        'icon-sm': 'size-7',
        'icon-lg': 'size-10'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  loadingIcon,
  loadingIconClassName,
  disabled,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
    loadingIcon?: React.ReactNode
    loadingIconClassName?: string
  }) {
  const Comp = asChild ? Slot : 'button'

  // Determine spinner size based on button size
  const getSpinnerSize = () => {
    if (size === 'icon-sm') return 13
    if (size === 'sm') return 14
    if (size === 'lg' || size === 'icon-lg') return 18
    return 16
  }

  // Default loading icon
  const defaultLoadingIcon = <Loader className={cn('animate-spin', loadingIconClassName)} size={getSpinnerSize()} />

  // Use custom icon or default icon
  const spinnerElement = loadingIcon ?? defaultLoadingIcon

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-loading={loading}
      {...props}>
      {/* asChild mode does not support loading because Slot requires a single child element */}
      {asChild ? (
        children
      ) : (
        <>
          {loading && spinnerElement}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
