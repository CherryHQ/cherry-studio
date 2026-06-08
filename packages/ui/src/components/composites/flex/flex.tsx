import { cn } from '@cherrystudio/ui/lib/utils'

import { Box, type BoxProps } from './box'
import { flexClasses, type FlexShape } from './lookups'

export interface FlexProps extends BoxProps, FlexShape {}

/**
 * General one-dimensional flex container. Owns its axes through typed props
 * (`direction`/`align`/`justify`/`gap`/`wrap`/`inline`) that compile to a closed
 * Tailwind class lookup; everything else (padding, sizing, color) stays in
 * `className`, which always wins last via `cn`. Prefer the intent presets
 * (`HStack`/`VStack`/`Stack`/`Center`) for the common cases.
 */
export function Flex({ className, direction, align, justify, gap, wrap, inline, ...props }: FlexProps) {
  return (
    <Box
      data-slot="flex"
      className={cn(flexClasses({ direction, align, justify, gap, wrap, inline }), className)}
      {...props}
    />
  )
}
