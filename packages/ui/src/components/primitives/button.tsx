import { cn } from '@cherrystudio/ui/utils/index'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader } from 'lucide-react'
import * as React from 'react'

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-xs text-sm font-medium transition-all',
    'disabled:pointer-events-none disabled:opacity-40',
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
    'aria-loading:cursor-progress aria-loading:opacity-40',
    'shadow-xs',
    // TODO 原值py-4 px-6 太胖了...
    'py-2 px-4'
  ),
  {
    variants: {
      variant: {
        default: 'bg-primary hover:bg-primary-hover text-white',
        destructive: 'bg-destructive text-white hover:bg-destructive-hover focus-visible:ring-destructive/20',
        outline: cn('border border-primary/40 bg-primary/10 text-primary', 'hover:bg-primary/5'),
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:text-primary-hover text-primary',
        link: 'text-primary underline-offset-4 hover:underline hover:text-primary-hover'
      },
      size: {
        default: 'min-h-9',
        sm: 'min-h-8 rounded-md gap-1.5',
        lg: 'min-h-10 rounded-md',
        icon: 'size-9',
        'icon-sm': 'size-8',
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
    if (size === 'sm' || size === 'icon-sm') return 14
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
