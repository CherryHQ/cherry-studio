import { CommandContextMenu } from '@renderer/components/command'
import ConfirmActionPopup from '@renderer/components/Popups/ConfirmActionPopup'
import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'

import { type ResourceListItemBase, useResourceListActions, useResourceListItemAccessors } from '../resourceList/base'
import { actionsToCommandMenuExtraItems } from './actionMenuItems'
import type { ResolvedAction } from './actionTypes'

type ResourceListActionContextMenuProps<T extends ResourceListItemBase, TActionContext = unknown> = {
  actions: readonly ResolvedAction<TActionContext>[]
  item: T
  children: ReactNode
  onAction: (action: ResolvedAction<TActionContext>) => void | Promise<void>
}

/**
 * Resource-list (topics, agent sessions, …) row context menu, rendered through the
 * command system's CommandContextMenu so it honors the `menu.presentation_mode`
 * preference (Cherry vs Native). Actions map to extra items; an action's inline
 * confirm becomes a `ConfirmActionPopup` that runs the action in-dialog (a native
 * OS menu cannot host an inline dialog).
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
    async (action: ResolvedAction<TActionContext>) => {
      if (!action.availability.enabled) return
      const confirm = action.confirm
      if (confirm) {
        // Confirm gates a fallible action: ConfirmActionPopup runs it in-dialog and
        // surfaces failures (toast + retry), so a rejected action is never silent.
        await ConfirmActionPopup.show({
          title: confirm.title,
          content: confirm.description ?? confirm.content,
          okText: confirm.confirmText,
          cancelText: confirm.cancelText,
          danger: confirm.destructive,
          action: () => onAction(action)
        })
        return
      }
      // Defer until after the menu has closed so the action's own UI (rename input,
      // popups) doesn't fight the menu close.
      window.requestAnimationFrame(() => void onAction(action))
    },
    [onAction]
  )

  const extraItems = useMemo(() => actionsToCommandMenuExtraItems(actions, runAction), [actions, runAction])

  // Set the active context-menu item on the right-click itself, not via `onOpenChange`:
  // open-change does not include the clicked row, while this wrapper fires for both
  // Cherry and native presentation modes.
  const markActiveItem = useCallback(() => listActions.openContextMenu(getItemId(item)), [listActions, getItemId, item])

  return (
    <CommandContextMenu location="webcontents.context" extraItems={extraItems}>
      <span className="contents" onContextMenu={markActiveItem}>
        {children}
      </span>
    </CommandContextMenu>
  )
}
