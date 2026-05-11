import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentPropsWithoutRef } from 'react'

/**
 * Inner padded container for the chat list. Used by `ChatVirtualList`
 * consumers that want consistent padding inside the virtualized
 * scroller. Flex-direction is now natural (column) — `ChatVirtualList`
 * handles its own scroll-to-bottom semantics.
 */
export const ScrollContainer = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-col px-2.5 pt-2.5 pb-5 [.multi-select-mode_&]:pb-[60px]', className)} {...props} />
)

interface ContainerProps {
  $right?: boolean
}

/**
 * Outer wrapper for the chat surface. **Not** the scroll element —
 * `ChatVirtualList` owns scrolling. Acts as the flex parent for the
 * virtualized list, the system-prompt banner, the anchor rail, and
 * the multi-select selection box.
 */
export const MessagesContainer = ({
  className,
  $right,
  ...props
}: ComponentPropsWithoutRef<'div'> & ContainerProps) => {
  void $right
  return <div className={cn('relative z-[1] flex h-full flex-col overflow-hidden', className)} {...props} />
}
