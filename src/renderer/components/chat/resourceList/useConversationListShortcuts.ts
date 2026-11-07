import { useEffect, useMemo } from 'react'

import { useCommandRuntime } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { useNumberShortcutHints } from '@renderer/hooks/useNumberShortcutHints'
import { CONVERSATION_NUMBER_COMMANDS as CONVERSATION_COMMANDS } from '@renderer/utils/numberShortcuts'

import { type ResourceListItemBase, useResourceListControlsState, useResourceListView } from './base'

export function useConversationListShortcuts<T extends ResourceListItemBase>(onOpen: (item: T) => void) {
  const view = useResourceListView<T>()
  const { status } = useResourceListControlsState()
  const active = useIsActiveTab()
  const runtime = useCommandRuntime()
  const items = useMemo(() => {
    const groups =
      view.sections.length > 0
        ? view.sections
            .filter((section) => view.sections.length === 1 || !section.collapsed)
            .flatMap((section) => section.groups)
        : view.groups
    return groups.flatMap((group) => group.items).slice(0, CONVERSATION_COMMANDS.length)
  }, [view])
  const enabled = active && status === 'idle'
  const commandHints = useNumberShortcutHints(CONVERSATION_COMMANDS, enabled)

  useEffect(() => {
    if (!enabled) return
    const dispose = CONVERSATION_COMMANDS.map((command, index) => {
      const item = items[index]
      return runtime.registerHandler(
        command,
        () => {
          if (item) onOpen(item)
        },
        { enabled: !!item }
      )
    })
    return () => dispose.forEach((remove) => remove())
  }, [enabled, items, onOpen, runtime])

  return useMemo(() => {
    const hints = new Map<string, string>()
    items.forEach((item, index) => {
      const label = commandHints.get(CONVERSATION_COMMANDS[index])
      if (label) hints.set(item.id, label)
    })
    return hints
  }, [commandHints, items])
}
