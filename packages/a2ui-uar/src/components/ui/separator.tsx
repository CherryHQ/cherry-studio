import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'

import { cn } from '../../lib/cn'

/** Vendored subset of `frontend/src/components/ui/separator.tsx` — see button.tsx for why this is a local copy. */
export function Separator({ className, orientation = 'horizontal', ...props }: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch',
        className
      )}
      {...props}
    />
  )
}
