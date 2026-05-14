import { Fragment, useMemo, useState } from 'react'

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
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
  onAction
}: ActionMenuProps<TContext>) {
  const groupedActions = useMemo(() => groupActions(actions), [actions])
  const [pendingAction, setPendingAction] = useState<ResolvedAction<TContext> | undefined>()

  const runAction = async (action: ResolvedAction<TContext>) => {
    if (!action.availability.enabled) return
    await onAction(action)
  }

  const renderAction = (action: ResolvedAction<TContext>) => {
    const disabled = !action.availability.enabled
    const content = (
      <>
        {action.icon}
        <span className="min-w-0 flex-1 truncate">{action.label}</span>
        {action.shortcut && <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>}
      </>
    )

    if (action.children.length > 0) {
      return (
        <ContextMenuSub key={action.id}>
          <ContextMenuSubTrigger
            disabled={disabled}
            className="gap-2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0">
            {content}
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
        {content}
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
        }}
      />
    </>
  )
}
