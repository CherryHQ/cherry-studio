import { cn } from '@cherrystudio/ui/lib/utils'

import { Flex, type FlexProps } from './flex'

export interface PageShellProps extends Omit<FlexProps, 'direction'> {
  /** Add `overflow-y-auto` for a scrollable body; otherwise `overflow-hidden`. */
  scroll?: boolean
}

/**
 * The generic page/panel fill shell: `flex min-h-0 flex-1 flex-col` with managed
 * overflow. Owns the easily-dropped `min-h-0` so nested scroll areas behave. Does
 * NOT own DESIGN.md-governed chrome (PageHeader, Dialog, Drawer, PageSidePanel) —
 * those keep their baked geometry.
 */
export function PageShell({ className, scroll = false, gap = 0, ...props }: PageShellProps) {
  return (
    <Flex
      data-slot="page-shell"
      direction="col"
      gap={gap}
      className={cn('min-h-0 flex-1', scroll ? 'overflow-y-auto' : 'overflow-hidden', className)}
      {...props}
    />
  )
}
