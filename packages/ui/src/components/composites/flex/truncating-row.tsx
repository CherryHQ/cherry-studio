import { cn } from '@cherrystudio/ui/lib/utils'
import type { ReactNode } from 'react'

import { Flex, type FlexProps } from './flex'

export interface TruncatingRowProps extends Omit<FlexProps, 'direction'> {
  /** Fixed-width (`shrink-0`) leading slot, e.g. an icon or avatar. */
  leading?: ReactNode
  /** Fixed-width (`shrink-0`) trailing slot, e.g. a badge or action control. */
  trailing?: ReactNode
}

/**
 * A horizontal row whose growable middle region can truncate safely. Bakes the
 * error-prone parent half of the truncation contract: the row gets `min-w-0`, the
 * content region gets `min-w-0 flex-1`, and the optional `leading`/`trailing`
 * slots get `shrink-0`. The content child still applies `truncate` (or wraps in
 * `Ellipsis` for multi-line clamp).
 */
export function TruncatingRow({
  className,
  gap = 2,
  align = 'center',
  justify,
  leading,
  trailing,
  children,
  ...props
}: TruncatingRowProps) {
  return (
    <Flex
      data-slot="truncating-row"
      direction="row"
      align={align}
      justify={justify}
      gap={gap}
      className={cn('min-w-0', className)}
      {...props}>
      {leading != null && (
        <span data-slot="truncating-row-leading" className="flex shrink-0 items-center">
          {leading}
        </span>
      )}
      <div data-slot="truncating-row-content" className="min-w-0 flex-1">
        {children}
      </div>
      {trailing != null && (
        <span data-slot="truncating-row-trailing" className="flex shrink-0 items-center">
          {trailing}
        </span>
      )}
    </Flex>
  )
}
