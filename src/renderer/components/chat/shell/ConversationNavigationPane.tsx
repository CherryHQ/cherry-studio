import type { HTMLAttributes } from 'react'

import { cn } from '@renderer/utils/style'

export function ConversationNavigationPane({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'conversation-navigation-pane relative flex h-full min-h-0 w-full flex-col overflow-hidden',
        className
      )}
      {...props}>
      <div className="conversation-navigation-pane-content flex flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  )
}
