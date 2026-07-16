import { useOverflowIconOnly } from '@renderer/hooks/useOverflowIconOnly'
import { cn } from '@renderer/utils/style'
import { createContext, type ReactNode, use, useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

type ConversationTopBarPortalContextValue = {
  iconOnly: boolean
  target: HTMLDivElement | null
  setTarget: (target: HTMLDivElement | null) => void
}

const ConversationTopBarPortalContext = createContext<ConversationTopBarPortalContextValue | undefined>(undefined)

export function ConversationTopBarPortalProvider({ children }: { children: ReactNode }) {
  const { iconOnly, containerRef } = useOverflowIconOnly()
  const [target, setPortalTarget] = useState<HTMLDivElement | null>(null)
  const setTarget = useCallback(
    (nextTarget: HTMLDivElement | null) => {
      containerRef(nextTarget)
      setPortalTarget(nextTarget)
    },
    [containerRef]
  )
  const value = useMemo(() => ({ iconOnly, target, setTarget }), [iconOnly, setTarget, target])

  return <ConversationTopBarPortalContext value={value}>{children}</ConversationTopBarPortalContext>
}

export function ConversationTopBarPortalHost({ className }: { className?: string }) {
  const context = use(ConversationTopBarPortalContext)

  return (
    <div
      ref={context?.setTarget}
      data-conversation-topbar-controls
      className={cn(
        'ml-2 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden [-webkit-app-region:no-drag] [&_button]:h-7 [&_button]:px-1.5',
        className
      )}
    />
  )
}

export function ConversationTopBarPortal({ children }: { children: ReactNode }) {
  const context = use(ConversationTopBarPortalContext)

  if (!context) return children
  if (!context.target) return null

  return createPortal(children, context.target)
}

export function useConversationTopBarPortalLayout() {
  const context = use(ConversationTopBarPortalContext)
  return { available: context !== undefined, iconOnly: context?.iconOnly ?? false }
}
