import type { ConversationResourceMenuItem } from '@renderer/components/chat/resourceList/base'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ConversationResourceKind } from './ConversationResourceView'

export type ConversationResourceViewDefinition<TKind extends ConversationResourceKind = ConversationResourceKind> = {
  icon?: ReactNode
  id: string
  kind: TKind
  label: ReactNode
}

type ActiveResourceViewState<TKind extends ConversationResourceKind> = {
  conversationKey: string
  kind: TKind
}

type UseConversationResourceViewOptions<TKind extends ConversationResourceKind> = {
  conversationKey: string
  definitions: readonly ConversationResourceViewDefinition<TKind>[]
  disabled?: boolean
}

export function useConversationResourceView<TKind extends ConversationResourceKind>({
  conversationKey,
  definitions,
  disabled = false
}: UseConversationResourceViewOptions<TKind>) {
  const [active, setActive] = useState<ActiveResourceViewState<TKind> | null>(null)
  const activeDefinitionExists = active ? definitions.some((definition) => definition.kind === active.kind) : false
  const activeKind =
    !disabled && active?.conversationKey === conversationKey && activeDefinitionExists ? active.kind : null

  const open = useCallback(
    (kind: TKind) => {
      setActive({ conversationKey, kind })
    },
    [conversationKey]
  )
  const close = useCallback(() => {
    setActive(null)
  }, [])

  useEffect(() => {
    if (!active) return
    const activeStillValid =
      !disabled &&
      active.conversationKey === conversationKey &&
      definitions.some((definition) => definition.kind === active.kind)
    if (activeStillValid) return

    setActive(null)
  }, [active, conversationKey, definitions, disabled])

  const menuItems = useMemo<readonly ConversationResourceMenuItem[] | undefined>(() => {
    if (disabled || definitions.length === 0) return undefined

    return definitions.map((definition) => ({
      active: activeKind === definition.kind,
      icon: definition.icon,
      id: definition.id,
      label: definition.label,
      onSelect: () => (activeKind === definition.kind ? close() : open(definition.kind))
    }))
  }, [activeKind, close, definitions, disabled, open])

  return {
    activeKind,
    close,
    menuItems,
    open
  }
}
