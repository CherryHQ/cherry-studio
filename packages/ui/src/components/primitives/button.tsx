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
        // Brainwave 2.0 "metallic" CTA: vertical gradient + rim lighting + 1px hairline frame.
        // Light mode (default): top #323232 → bottom #222222 with white text.
        // Dark mode: inverted to a light gradient with dark text for the same contrast role.
        // Pressed / focus-visible flip the gradient (concave / inset look).
        default: cn(
          'rounded-[10px] font-semibold tracking-tight',
          'bg-gradient-to-b from-[var(--cs-button-elevated-from)] to-[var(--cs-button-elevated-to)] text-[color:var(--cs-button-elevated-foreground)]',
          'shadow-[0_2px_4px_-1px_var(--cs-button-elevated-shadow),0_0_0_1px_var(--cs-button-elevated-rim),inset_0_0.5px_1px_var(--cs-button-elevated-highlight),inset_0_-1px_1.2px_0.35px_var(--cs-button-elevated-inner-shadow)]',
          'active:from-[var(--cs-button-elevated-to)] active:to-[var(--cs-button-elevated-from)]',
          'focus-visible:from-[var(--cs-button-elevated-to)] focus-visible:to-[var(--cs-button-elevated-from)]',
          'disabled:opacity-30 data-[loading=true]:opacity-30'
        ),
        destructive: 'bg-destructive text-white hover:bg-destructive-hover focus-visible:ring-destructive/20',
        outline: 'border border-border bg-transparent text-foreground shadow-none hover:bg-accent',
        secondary: 'rounded-lg bg-secondary text-secondary-foreground shadow-none hover:bg-secondary-hover',
        /** Dialog primary action style: same color hierarchy as default, with a flatter v2 shell. */
        emphasis: 'rounded-lg bg-primary text-primary-foreground shadow-none hover:bg-primary-hover',
        ghost: 'text-primary shadow-none hover:bg-accent hover:text-accent-foreground',
        link: 'text-link underline-offset-4 hover:underline'
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
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
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
