import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

interface ContainerProps {
  $right?: boolean
}

/**
 * Outer wrapper for the chat surface. **Not** the scroll element —
 * `MessageVirtualList` owns scrolling. Acts as the flex parent for the
 * virtualized list, the system-prompt banner, the anchor rail, and
 * the multi-select selection box.
 */
export const MessagesContainer = ({
  className,
  $right,
  ...props
}: ComponentPropsWithoutRef<'div'> & ContainerProps) => {
  void $right
  return (
    <div
      data-ui="chat.message-list"
      className={cn('relative flex h-full flex-col overflow-hidden', className)}
      {...props}
    />
  )
}
