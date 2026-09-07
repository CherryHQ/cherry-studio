import { useCallback, useEffect, useState } from 'react'

export type ConversationCenterSurface<TResourceKind extends string> =
  | {
      conversationKey: string
      kind: TResourceKind
      type: 'resource'
    }
  | {
      conversationKey: string
      type: 'history'
    }

type UseConversationCenterSurfaceOptions<TResourceKind extends string> = {
  conversationKey: string
  disabled?: boolean
  resourceKinds: readonly TResourceKind[]
}

export function useConversationCenterSurface<TResourceKind extends string>({
  conversationKey,
  disabled = false,
  resourceKinds
}: UseConversationCenterSurfaceOptions<TResourceKind>) {
  const [active, setActive] = useState<ConversationCenterSurface<TResourceKind> | null>(null)

  const activeResourceExists =
    active?.type === 'resource'
      ? resourceKinds.some((resourceKind) => resourceKind === active.kind)
      : active?.type === 'history'
  const activeSurface = !disabled && active?.conversationKey === conversationKey && activeResourceExists ? active : null
  const activeResourceKind = activeSurface?.type === 'resource' ? activeSurface.kind : null
  const historyActive = activeSurface?.type === 'history'

  const closeSurface = useCallback(() => {
    setActive(null)
  }, [])

  const toggleResource = useCallback(
    (kind: TResourceKind) => {
      if (disabled) {
        setActive(null)
        return
      }

      setActive((current) =>
        current?.conversationKey === conversationKey && current.type === 'resource' && current.kind === kind
          ? null
          : { conversationKey, kind, type: 'resource' }
      )
    },
    [conversationKey, disabled]
  )

  const toggleHistory = useCallback(() => {
    if (disabled) {
      setActive(null)
      return
    }

    setActive((current) =>
      current?.conversationKey === conversationKey && current.type === 'history'
        ? null
        : { conversationKey, type: 'history' }
    )
  }, [conversationKey, disabled])

  useEffect(() => {
    if (!active) return

    const activeStillValid =
      !disabled &&
      active.conversationKey === conversationKey &&
      (active.type === 'history' || resourceKinds.some((resourceKind) => resourceKind === active.kind))

    if (activeStillValid) return
    setActive(null)
  }, [active, conversationKey, disabled, resourceKinds])

  return {
    activeResourceKind,
    closeSurface,
    historyActive,
    toggleHistory,
    toggleResource
  }
}
