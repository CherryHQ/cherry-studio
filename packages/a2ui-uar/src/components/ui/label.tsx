import type { ComponentProps } from 'react'

import { cn } from '../../lib/cn'

/** Vendored subset of `frontend/src/components/ui/label.tsx` — see button.tsx for why this is a local copy. */
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
