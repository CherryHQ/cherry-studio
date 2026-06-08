import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentProps } from 'react'

export interface SpacerProps extends ComponentProps<'div'> {}

/**
 * A flexible filler (`flex-1`) that pushes siblings apart — the self-documenting
 * replacement for an empty `<div className="flex-1" />` or ad-hoc `ml-auto`.
 * Prefer `justify="between"` on the parent when there are exactly two groups.
 */
export function Spacer({ className, ...props }: SpacerProps) {
  return <div data-slot="spacer" aria-hidden className={cn('flex-1', className)} {...props} />
}
