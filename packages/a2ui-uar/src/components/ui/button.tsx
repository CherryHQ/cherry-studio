import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/cn'

/**
 * Vendored subset of `frontend/src/components/ui/button.tsx` (shadcn/ui,
 * `style: base-vega`, Base UI primitives). This package is self-contained
 * (its own build/test lifecycle, like `a2ui-core`/`a2ui-react`), so it
 * keeps a local copy of the handful of primitives it needs rather than
 * reaching across the workspace into `frontend/src`.
 */
const buttonVariants = cva(
  'group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow,transform] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        outline: 'bg-surface hover:bg-card-hov hover:text-foreground',
        ghost: 'hover:bg-muted hover:text-foreground dark:hover:bg-muted/50'
      },
      size: {
        default: 'min-h-11 gap-1.5 px-3 py-2'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export interface ButtonProps extends ButtonPrimitive.Props, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
