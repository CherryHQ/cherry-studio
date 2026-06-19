import type { CommandContextMenuExtraItem } from '@renderer/components/command'

import type { ResolvedAction } from './actionTypes'

/**
 * Converts ResolvedAction trees into CommandContextMenu extra items. Invisible
 * actions are skipped; group boundaries become separators. The provided
 * runAction callback is invoked for leaf items (it owns confirm dialogs).
 */
export function actionsToCommandMenuExtraItems<TContext>(
  actions: readonly ResolvedAction<TContext>[],
  runAction: (action: ResolvedAction<TContext>) => void
): CommandContextMenuExtraItem[] {
  const items: CommandContextMenuExtraItem[] = []
  let previousGroup: string | undefined

  for (const action of actions) {
    if (!action.availability.visible) continue
    if (items.length > 0 && action.group !== previousGroup) {
      items.push({ type: 'separator' })
    }
    previousGroup = action.group

    if (action.children.length > 0) {
      items.push({
        type: 'submenu',
        id: action.id,
        label: action.label as string,
        icon: action.icon,
        enabled: action.availability.enabled,
        children: actionsToCommandMenuExtraItems(action.children, runAction)
      })
      continue
    }

    items.push({
      type: 'item',
      id: action.id,
      label: action.label as string,
      icon: action.icon,
      enabled: action.availability.enabled,
      destructive: action.danger,
      shortcutLabel: action.shortcut,
      onSelect: () => runAction(action)
    })
  }

  return items
}
