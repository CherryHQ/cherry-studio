import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

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

export type ConversationCenterResourceDefinition<TResourceKind extends string> = {
  icon?: ReactNode
  id: string
  kind: TResourceKind
  label: ReactNode
}

type ConversationCenterResourceMenuItem = {
  active?: boolean
  icon?: ReactNode
  id: string
  label: ReactNode
  onSelect: () => void | Promise<void>
}

type UseConversationCenterSurfaceOptions<TResourceKind extends string> = {
  conversationKey: string
  disabled?: boolean
  resourceDefinitions: readonly ConversationCenterResourceDefinition<TResourceKind>[]
}

export function useConversationCenterSurface<TResourceKind extends string>({
  conversationKey,
  disabled = false,
  resourceDefinitions
}: UseConversationCenterSurfaceOptions<TResourceKind>) {
  const [active, setActive] = useState<ConversationCenterSurface<TResourceKind> | null>(null)

  const activeResourceExists =
    active?.type === 'resource'
      ? resourceDefinitions.some((definition) => definition.kind === active.kind)
      : active?.type === 'history'
  const activeSurface = !disabled && active?.conversationKey === conversationKey && activeResourceExists ? active : null
  const activeResourceKind = activeSurface?.type === 'resource' ? activeSurface.kind : null
  const historyActive = activeSurface?.type === 'history'

  const closeSurface = useCallback(() => {
    setActive(null)
  }, [])

  const openResource = useCallback(
    (kind: TResourceKind) => {
      if (disabled) {
        setActive(null)
        return
      }

      setActive({ conversationKey, kind, type: 'resource' })
    },
    [conversationKey, disabled]
  )

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

  const openHistory = useCallback(() => {
    if (disabled) {
      setActive(null)
      return
    }

    setActive({ conversationKey, type: 'history' })
  }, [conversationKey, disabled])

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
      (active.type === 'history' || resourceDefinitions.some((definition) => definition.kind === active.kind))

    if (activeStillValid) return
    setActive(null)
  }, [active, conversationKey, disabled, resourceDefinitions])

  const resourceMenuItems = useMemo<readonly ConversationCenterResourceMenuItem[] | undefined>(() => {
    if (disabled || resourceDefinitions.length === 0) return undefined

    return resourceDefinitions.map((definition) => ({
      active: activeResourceKind === definition.kind,
      icon: definition.icon,
      id: definition.id,
      label: definition.label,
      onSelect: () => toggleResource(definition.kind)
    }))
  }, [activeResourceKind, disabled, resourceDefinitions, toggleResource])

  return {
    activeResourceKind,
    activeSurface,
    closeSurface,
    historyActive,
    openHistory,
    openResource,
    resourceMenuItems,
    toggleHistory,
    toggleResource
  }
}
