import { cn } from '@cherrystudio/ui/lib/utils'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader } from 'lucide-react'
import * as React from 'react'

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md font-normal transition-all',
    'disabled:pointer-events-none disabled:opacity-40',
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 [&_.lucide:not(.lucide-custom)]:text-current outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
    'data-[busy=true]:cursor-progress data-[busy=true]:opacity-40',
    'shadow-xs'
  ),
  {
    variants: {
      variant: {
        default:
          'bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200',
        destructive: 'bg-destructive text-white hover:bg-destructive-hover focus-visible:ring-destructive/20',
        outline: 'border border-border bg-transparent text-foreground shadow-none hover:bg-accent',
        secondary:
          'rounded-lg bg-secondary text-secondary-foreground shadow-none hover:bg-black/10 dark:hover:bg-white/20',
        /** Dialog primary action style: same color hierarchy as default, with a flatter v2 shell. */
        emphasis:
          'rounded-lg bg-neutral-900 text-white shadow-none hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200',
        ghost: 'text-neutral-900 shadow-none hover:bg-accent hover:text-accent-foreground dark:text-neutral-100',
        chip: 'rounded-lg bg-muted text-muted-foreground shadow-none hover:bg-black/10 hover:text-foreground dark:hover:bg-white/20',
        link: 'text-neutral-900 underline-offset-4 hover:text-neutral-700 hover:underline dark:text-neutral-100 dark:hover:text-neutral-300'
      },
      pressed: {
        true: '',
        false: ''
      },
      size: {
        default: 'min-h-7.5 gap-1.5 px-2.5 text-[13px]',
        sm: 'min-h-7 gap-1.5 px-2.5 text-xs',
        lg: 'min-h-9 px-4 text-sm',
        icon: 'size-9',
        'icon-sm': 'size-7',
        'icon-lg': 'size-10',
        /** Navbar / toolbar icon button: 30px box, 18px icon (8px radius from base). */
        'icon-navbar': 'size-[30px] [&_svg]:!size-[18px]'
      }
    },
    compoundVariants: [
      {
        variant: 'secondary',
        pressed: true,
        className: 'bg-black/15 text-foreground dark:bg-white/25'
      },
      {
        variant: 'ghost',
        pressed: true,
        className: 'bg-black/10 text-foreground dark:bg-white/15'
      },
      {
        variant: 'chip',
        pressed: true,
        className: 'bg-black/15 text-foreground ring-1 ring-foreground/30 dark:bg-white/25'
      }
    ],
    defaultVariants: {
      variant: 'default',
      pressed: false,
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
  pressed,
  disabled,
  children,
  'aria-pressed': ariaPressed,
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
    if (size === 'icon-navbar') return 18
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
      data-variant={variant ?? 'default'}
      data-pressed={pressed || undefined}
      className={cn(buttonVariants({ variant, pressed, size, className }))}
      disabled={disabled || loading}
      aria-pressed={pressed ?? ariaPressed}
      aria-busy={loading || undefined}
      data-busy={loading || undefined}
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

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>

export { Button, type ButtonVariant, buttonVariants }
