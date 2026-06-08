import { cn } from '@cherrystudio/ui/lib/utils'
import { Slot } from '@radix-ui/react-slot'
import type { ComponentProps } from 'react'

export interface BoxProps extends ComponentProps<'div'> {
  /** Render via Radix `Slot`, merging props/ref/className onto the single child instead of emitting a `<div>`. */
  asChild?: boolean
}

/**
 * The base block element every other layout primitive composes through. Owns only
 * `box-border`; carries `asChild` (polymorphism) and `data-slot` in one place and
 * forwards `ref` via the React 19 ref-as-prop convention. NOT a styling-prop
 * surface — style it with `className`.
 */
export function Box({ className, asChild = false, ...props }: BoxProps) {
  const Comp = asChild ? Slot : 'div'
  return <Comp data-slot="box" className={cn('box-border', className)} {...props} />
}
