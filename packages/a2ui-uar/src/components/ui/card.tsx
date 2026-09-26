import type { ComponentProps } from 'react'

import { cn } from '../../lib/cn'

/** Vendored subset of `frontend/src/components/ui/card.tsx` — see button.tsx for why this is a local copy. */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-sm text-card-foreground sm:gap-6 sm:py-6',
        className
      )}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('min-w-0 px-4 sm:px-6', className)} {...props} />
}
