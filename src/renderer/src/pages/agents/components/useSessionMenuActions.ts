import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { useCallback, useMemo } from 'react'

import { executeSessionMenuAction, resolveSessionMenuActions, type SessionActionContext } from './sessionItemActions'

export function createSessionActionContext(context: SessionActionContext): SessionActionContext {
  return context
}

export function getSessionMenuActions(actionContext: SessionActionContext) {
  return resolveSessionMenuActions(actionContext)
}

export async function runSessionMenuAction(
  action: ResolvedAction<SessionActionContext>,
  actionContext: SessionActionContext
) {
  await executeSessionMenuAction(action, actionContext)
}

export interface SessionMenuPreset<TItem> {
  getActions: (item: TItem) => readonly ResolvedAction[]
  onAction: (item: TItem, action: ResolvedAction) => void | Promise<void>
}

export function useSessionMenuPreset<TItem>({
  getActionContext
}: {
  getActionContext: (item: TItem) => SessionActionContext
}): SessionMenuPreset<TItem> {
  const getActions = useCallback(
    (item: TItem) => getSessionMenuActions(getActionContext(item)) as ResolvedAction[],
    [getActionContext]
  )
  const onAction = useCallback(
    async (item: TItem, action: ResolvedAction) => {
      await runSessionMenuAction(action as ResolvedAction<SessionActionContext>, getActionContext(item))
    },
    [getActionContext]
  )

  return useMemo(() => ({ getActions, onAction }), [getActions, onAction])
}

export function useSessionMenuActions(actionContext: SessionActionContext) {
  const menuActions = useMemo(() => getSessionMenuActions(actionContext), [actionContext])
  const handleMenuAction = useCallback(
    async (action: ResolvedAction<SessionActionContext>) => {
      await runSessionMenuAction(action, actionContext)
    },
    [actionContext]
  )

  return { menuActions, handleMenuAction }
}
