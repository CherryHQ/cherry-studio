import { useOverflowIconOnly } from '@renderer/hooks/useOverflowIconOnly'
import { cn } from '@renderer/utils/style'
import { createContext, type ReactNode, use, useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

type ConversationTopBarPortalContextValue = {
  iconOnly: boolean
  leadingTarget: HTMLDivElement | null
  setLeadingTarget: (target: HTMLDivElement | null) => void
  target: HTMLDivElement | null
  setTarget: (target: HTMLDivElement | null) => void
}

const ConversationTopBarPortalContext = createContext<ConversationTopBarPortalContextValue | undefined>(undefined)

export function ConversationTopBarPortalProvider({ children }: { children: ReactNode }) {
  const { iconOnly, containerRef } = useOverflowIconOnly()
  const [leadingTarget, setLeadingTarget] = useState<HTMLDivElement | null>(null)
  const [target, setPortalTarget] = useState<HTMLDivElement | null>(null)
  const setTarget = useCallback(
    (nextTarget: HTMLDivElement | null) => {
      containerRef(nextTarget)
      setPortalTarget(nextTarget)
    },
    [containerRef]
  )
  const value = useMemo(
    () => ({ iconOnly, leadingTarget, setLeadingTarget, target, setTarget }),
    [iconOnly, leadingTarget, setTarget, target]
  )

  return <ConversationTopBarPortalContext value={value}>{children}</ConversationTopBarPortalContext>
}

export function ConversationTopBarLeadingPortalHost() {
  const context = use(ConversationTopBarPortalContext)

  return (
    <div
      ref={context?.setLeadingTarget}
      data-conversation-topbar-leading
      className="flex shrink-0 items-center [-webkit-app-region:no-drag]"
    />
  )
}

export function ConversationTopBarLeadingPortal({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const context = use(ConversationTopBarPortalContext)

  if (!enabled || !context) return children
  if (!context.leadingTarget) return null

  return createPortal(children, context.leadingTarget)
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
