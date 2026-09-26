import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { CheckIcon } from 'lucide-react'

import { cn } from '../../lib/cn'

/** Vendored subset of `frontend/src/components/ui/checkbox.tsx` — see button.tsx for why this is a local copy. */
export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-surface transition-colors outline-none after:absolute after:-inset-3 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary data-checked:text-primary-foreground',
        className
      )}
      {...props}>
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5">
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
