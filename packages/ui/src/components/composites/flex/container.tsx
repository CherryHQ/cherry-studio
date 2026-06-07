import { cn } from '@cherrystudio/ui/lib/utils'

import { Box, type BoxProps } from './box'

export type ContainerSize = 'settings' | 'gallery'

export interface ContainerProps extends BoxProps {
  /** Which house width cap to apply (DESIGN.md §5): `settings` = `max-w-3xl`, `gallery` = `max-w-5xl`. */
  size?: ContainerSize
  /** Apply the §5 outer edge padding (`px-6 py-4`). Default true; set false when embedded. */
  padded?: boolean
  /** Drop the max-width cap (the §5 embedding fallback for compact/PageSidePanel contexts). */
  fluid?: boolean
}

const CONTAINER_MAX: Record<ContainerSize, string> = {
  settings: 'max-w-3xl',
  gallery: 'max-w-5xl'
}

/**
 * Caps and centers page content width using the two house caps DESIGN.md §5
 * mandates, via the established two-layer pattern: an outer padded full-width
 * shell wrapping an inner `mx-auto w-full max-w-*` column.
 */
export function Container({
  className,
  size = 'settings',
  padded = true,
  fluid = false,
  children,
  ...props
}: ContainerProps) {
  return (
    <Box data-slot="container" className={cn(padded && 'px-6 py-4', className)} {...props}>
      <div data-slot="container-inner" className={cn('mx-auto w-full', !fluid && CONTAINER_MAX[size])}>
        {children}
      </div>
    </Box>
  )
}
