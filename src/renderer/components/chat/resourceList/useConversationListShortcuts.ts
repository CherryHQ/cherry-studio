import { use, useEffect, useMemo, useRef } from 'react'

import { CommandFocusHostContext, CommandFocusScopeContext } from '@renderer/hooks/command'
import { useIsActiveTab, useTabCommandRuntime } from '@renderer/hooks/tab'
import { useNumberShortcutHints } from '@renderer/hooks/useNumberShortcutHints'
import { CONVERSATION_NUMBER_COMMANDS as CONVERSATION_COMMANDS } from '@renderer/utils/numberShortcuts'

import { type ResourceListItemBase, useResourceListControlsState, useResourceListView } from './base'

export function useConversationListShortcuts<T extends ResourceListItemBase>(onOpen: (item: T) => void) {
  const view = useResourceListView<T>()
  const { status } = useResourceListControlsState()
  const active = useIsActiveTab()
  const listScope = use(CommandFocusScopeContext)
  const host = use(CommandFocusHostContext)
  const tabRuntime = useTabCommandRuntime()
  // Conversation navigation must survive the composer unmount returning focus to document.body.
  const runtime = useMemo(() => (host ? host.forScope(host.rootScope) : tabRuntime), [host, tabRuntime])
  const items = useMemo(() => {
    const groups =
      view.sections.length > 0
        ? view.sections
            .filter((section) => view.sections.length === 1 || !section.collapsed)
            .flatMap((section) => section.groups)
        : view.groups
    return groups.flatMap((group) => group.items).slice(0, CONVERSATION_COMMANDS.length)
  }, [view])
  const stateRef = useRef({ items, onOpen })
  stateRef.current = { items, onOpen }
  const itemCount = items.length
  const enabled = active && status === 'idle'
  const commandHints = useNumberShortcutHints(CONVERSATION_COMMANDS, enabled)

  useEffect(() => {
    if (!enabled) return
    const dispose = CONVERSATION_COMMANDS.map((command, index) => {
      return runtime.registerHandler(
        command,
        () => {
          const { items, onOpen } = stateRef.current
          const item = items[index]
          if (item) onOpen(item)
        },
        { enabled: () => index < itemCount && (listScope?.isActive() ?? true) }
      )
    })
    return () => dispose.forEach((remove) => remove())
  }, [enabled, itemCount, listScope, runtime])

  return useMemo(() => {
    const hints = new Map<string, string>()
    items.forEach((item, index) => {
      const label = commandHints.get(CONVERSATION_COMMANDS[index])
      if (label) hints.set(item.id, label)
    })
    return hints
  }, [commandHints, items])
}
