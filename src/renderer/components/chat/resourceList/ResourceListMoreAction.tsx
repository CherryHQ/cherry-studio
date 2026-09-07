import { Tooltip } from '@cherrystudio/ui'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { CommandPopupMenu } from '@renderer/components/command'
import ConfirmActionPopup from '@renderer/components/popups/ConfirmActionPopup'
import { MoreHorizontal } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceList } from './base'

interface ResourceListMoreActionProps<TContext> {
  actions: readonly ResolvedAction<TContext>[]
  onAction: (action: ResolvedAction<TContext>) => void | Promise<void>
}

export function ResourceListMoreAction<TContext>({ actions, onAction }: ResourceListMoreActionProps<TContext>) {
  const { t } = useTranslation()

  const runAction = useCallback(
    async (action: ResolvedAction<TContext>) => {
      if (!action.availability.enabled) return

      const confirm = action.confirm
      if (confirm) {
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

      await onAction(action)
    },
    [onAction]
  )

  const extraItems = useMemo(
    () => actionsToCommandMenuExtraItems(actions, (action) => void runAction(action)),
    [actions, runAction]
  )

  if (extraItems.length === 0) return null

  return (
    <Tooltip title={t('common.more')} delay={500}>
      <CommandPopupMenu location="webcontents.context" extraItems={extraItems} align="end" side="bottom">
        <ResourceList.ItemAction
          alwaysVisible
          type="button"
          aria-label={t('common.more')}
          onClick={(event) => event.stopPropagation()}>
          <MoreHorizontal aria-hidden="true" />
        </ResourceList.ItemAction>
      </CommandPopupMenu>
    </Tooltip>
  )
}

export type { ResourceListMoreActionProps }
