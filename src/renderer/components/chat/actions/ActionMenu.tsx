import { Fragment, useMemo, useState } from 'react'

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '../primitives'
import { ActionConfirmDialog } from './ActionConfirmDialog'
import type { ResolvedAction } from './actionTypes'

export interface ActionMenuProps<TContext = unknown> {
  actions: readonly ResolvedAction<TContext>[]
  className?: string
  confirmDialogContentClassName?: string
  confirmDialogOverlayClassName?: string
  onAction: (action: ResolvedAction<TContext>) => void | Promise<void>
  onConfirmActionComplete?: () => void
}

function groupActions<TContext>(actions: readonly ResolvedAction<TContext>[]) {
  const grouped: Array<{ action: ResolvedAction<TContext>; separatorBefore: boolean }> = []
  let previousGroup: string | undefined

  for (const action of actions) {
    grouped.push({
      action,
      separatorBefore: grouped.length > 0 && action.group !== previousGroup
    })
    previousGroup = action.group
  }

  return grouped
}

export function ActionMenu<TContext = unknown>({
  actions,
  className,
  confirmDialogContentClassName,
  confirmDialogOverlayClassName,
  onAction,
  onConfirmActionComplete
}: ActionMenuProps<TContext>) {
  const groupedActions = useMemo(() => groupActions(actions), [actions])
  const [pendingAction, setPendingAction] = useState<ResolvedAction<TContext> | undefined>()

  const runAction = async (action: ResolvedAction<TContext>) => {
    if (!action.availability.enabled) return
    await onAction(action)
  }

  const renderAction = (action: ResolvedAction<TContext>) => {
    const disabled = !action.availability.enabled

    if (action.children.length > 0) {
      return (
        <ContextMenuSub key={action.id}>
          <ContextMenuSubTrigger disabled={disabled}>
            <ContextMenuItemContent icon={action.icon}>{action.label}</ContextMenuItemContent>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>{action.children.map(renderAction)}</ContextMenuSubContent>
        </ContextMenuSub>
      )
    }

    return (
      <ContextMenuItem
        key={action.id}
        disabled={disabled}
        variant={action.danger ? 'destructive' : 'default'}
        onSelect={(event) => {
          if (action.confirm) {
            event.preventDefault()
            setPendingAction(action)
            return
          }
          void runAction(action)
        }}>
        <ContextMenuItemContent icon={action.icon} shortcut={action.shortcut}>
          {action.label}
        </ContextMenuItemContent>
      </ContextMenuItem>
    )
  }

  return (
    <>
      <ContextMenuContent className={className}>
        {groupedActions.map(({ action, separatorBefore }) => (
          <Fragment key={action.id}>
            {separatorBefore && <ContextMenuSeparator />}
            {renderAction(action)}
          </Fragment>
        ))}
      </ContextMenuContent>
      <ActionConfirmDialog
        open={!!pendingAction}
        confirm={pendingAction?.confirm}
        contentClassName={confirmDialogContentClassName}
        overlayClassName={confirmDialogOverlayClassName}
        onOpenChange={(open) => {
          if (!open) setPendingAction(undefined)
        }}
        onConfirm={async () => {
          if (!pendingAction) return
          await runAction(pendingAction)
          setPendingAction(undefined)
          onConfirmActionComplete?.()
        }}
      />
    </>
  )
}
