import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/commands'
import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'

import {
  type ResourceListItemBase,
  useResourceListActions,
  useResourceListItemAccessors
} from '../resources/ResourceListContext'
import type { ResolvedAction } from './actionTypes'

type ResourceListActionContextMenuProps<T extends ResourceListItemBase, TActionContext = unknown> = {
  actions: readonly ResolvedAction<TActionContext>[]
  item: T
  children: ReactNode
  className?: string
  confirmDialogContentClassName?: string
  confirmDialogOverlayClassName?: string
  onAction: (action: ResolvedAction<TActionContext>) => void | Promise<void>
}

/**
 * Resource-list (topics, agent sessions, …) row context menu, rendered through the
 * command system's CommandContextMenu so it honors the `menu.presentation_mode`
 * preference (Cherry vs Native). Actions map to extra items; an action's inline
 * confirm becomes a `window.modal.confirm` popup (a native OS menu cannot host an
 * inline dialog).
 */
export function ResourceListActionContextMenu<T extends ResourceListItemBase, TActionContext = unknown>({
  actions,
  item,
  children,
  onAction
}: ResourceListActionContextMenuProps<T, TActionContext>) {
  const listActions = useResourceListActions()
  const { getItemId } = useResourceListItemAccessors<T>()

  const runAction = useCallback(
    (action: ResolvedAction<TActionContext>) => {
      if (!action.availability.enabled) return
      const confirm = action.confirm
      if (confirm) {
        void window.modal.confirm({
          title: confirm.title,
          content: confirm.description ?? confirm.content,
          okText: confirm.confirmText,
          cancelText: confirm.cancelText,
          centered: true,
          okButtonProps: confirm.destructive ? { danger: true } : undefined,
          onOk: () => onAction(action)
        })
        return
      }
      // Defer until after the menu has closed so the action's own UI (rename input,
      // popups) doesn't fight the menu close.
      window.requestAnimationFrame(() => void onAction(action))
    },
    [onAction]
  )

  const extraItems = useMemo<CommandContextMenuExtraItem[]>(() => {
    const toItems = (list: readonly ResolvedAction<TActionContext>[]): CommandContextMenuExtraItem[] => {
      const items: CommandContextMenuExtraItem[] = []
      let previousGroup: string | undefined
      for (const action of list) {
        if (!action.availability.visible) continue
        if (items.length > 0 && action.group !== previousGroup) {
          items.push({ type: 'separator' })
        }
        previousGroup = action.group
        if (action.children.length > 0) {
          items.push({
            type: 'submenu',
            id: action.id,
            // Resource-list action labels resolve to plain strings.
            label: action.label as string,
            icon: action.icon,
            enabled: action.availability.enabled,
            children: toItems(action.children)
          })
        } else {
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
      }
      return items
    }
    return toItems(actions)
  }, [actions, runAction])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) listActions.openContextMenu(getItemId(item))
    },
    [listActions, getItemId, item]
  )

  return (
    <CommandContextMenu location="webcontents.context" extraItems={extraItems} onOpenChange={handleOpenChange}>
      {children}
    </CommandContextMenu>
  )
}
