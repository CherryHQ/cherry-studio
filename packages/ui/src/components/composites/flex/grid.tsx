import { cn } from '@cherrystudio/ui/lib/utils'

import { Box, type BoxProps } from './box'
import { type GapProp, type GridColumns, gridColumnsClasses, type GridFlow, gridFlowClass, resolveGap } from './lookups'

export interface GridProps extends BoxProps {
  /**
   * Column count. A number maps to `grid-cols-N`; an object maps each breakpoint
   * to a static `sm:grid-cols-N` etc. For arbitrary templates
   * (`grid-cols-[minmax(0,1fr)_auto]`) use `className`.
   */
  columns?: GridColumns
  /** Track gap, bound to the numeric Tailwind scale. */
  gap?: GapProp
  /** `grid-auto-flow`. */
  flow?: GridFlow
}

/**
 * Two-dimensional CSS-grid container. Responsive column counts compile to a
 * closed, statically-analyzable lookup — never template interpolation.
 */
export function Grid({ className, columns, gap = 3, flow, ...props }: GridProps) {
  return (
    <Box
      data-slot="grid"
      className={cn('grid', gridColumnsClasses(columns), resolveGap(gap), gridFlowClass(flow), className)}
      {...props}
    />
  )
}
