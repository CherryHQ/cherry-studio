import { cn } from '@cherrystudio/ui/lib/utils'
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'

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
 * optional `leading`/`trailing` slots get `shrink-0`, and the growable content
 * region gets `min-w-0 flex-1`.
 *
 * A single element child receives `min-w-0 flex-1` directly (so a child carrying
 * `truncate` stays a flex item and clips correctly — matching the hand-rolled
 * pattern); multiple/text children fall back to a `min-w-0 flex-1` wrapper. The
 * content child still applies `truncate` (or wraps in `Ellipsis` for multi-line).
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
  const content =
    isValidElement(children) && Children.count(children) === 1 ? (
      cloneElement(children as ReactElement<{ className?: string }>, {
        className: cn('min-w-0 flex-1', (children as ReactElement<{ className?: string }>).props.className)
      })
    ) : (
      <div data-slot="truncating-row-content" className="min-w-0 flex-1">
        {children}
      </div>
    )

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
      {content}
      {trailing != null && (
        <span data-slot="truncating-row-trailing" className="flex shrink-0 items-center">
          {trailing}
        </span>
      )}
    </Flex>
  )
}
