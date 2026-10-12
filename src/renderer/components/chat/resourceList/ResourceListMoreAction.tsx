import { MoreHorizontal } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Tooltip } from '@cherrystudio/ui'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { executeResourceListAction } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import { CommandPopupMenu } from '@renderer/components/command'

import { ResourceList } from './base'

interface ResourceListMoreActionProps<TContext> {
  actions: readonly ResolvedAction<TContext>[]
  onAction: (action: ResolvedAction<TContext>) => void | Promise<void>
}

export function ResourceListMoreAction<TContext>({ actions, onAction }: ResourceListMoreActionProps<TContext>) {
  const { t } = useTranslation()

  const runAction = useCallback(
    (action: ResolvedAction<TContext>) => executeResourceListAction(action, onAction),
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
