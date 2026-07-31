import type { HTMLAttributes } from 'react'

import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { cn } from '@renderer/utils/style'

export function ConversationNavigationPane({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const isWindowFrame = useWindowFrame().mode === 'window'

  return (
    <div
      className={cn(
        'conversation-navigation-pane relative flex w-[var(--assistants-width)] flex-col overflow-hidden transition-[width] duration-300',
        isWindowFrame ? 'h-full' : 'h-[calc(100vh_-_var(--navbar-height))]',
        className
      )}
      {...props}>
      <div className="conversation-navigation-pane-content flex flex-1 flex-col overflow-hidden transition-[width] duration-300">
        {children}
      </div>
    </div>
  )
}
