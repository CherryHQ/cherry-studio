import { cn } from '@renderer/utils/style'
import { createContext, type ReactNode, use, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

type ConversationTopBarPortalContextValue = {
  target: HTMLDivElement | null
  setTarget: (target: HTMLDivElement | null) => void
}

const ConversationTopBarPortalContext = createContext<ConversationTopBarPortalContextValue | undefined>(undefined)

export function ConversationTopBarPortalProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const value = useMemo(() => ({ target, setTarget }), [target])

  return <ConversationTopBarPortalContext value={value}>{children}</ConversationTopBarPortalContext>
}

export function ConversationTopBarPortalHost({ className }: { className?: string }) {
  const context = use(ConversationTopBarPortalContext)

  return (
    <div
      ref={context?.setTarget}
      data-conversation-topbar-controls
      className={cn(
        'ml-2 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden [-webkit-app-region:no-drag]',
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

export function useConversationTopBarPortalAvailable() {
  return use(ConversationTopBarPortalContext) !== undefined
}
