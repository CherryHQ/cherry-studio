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

export type SessionMenuActionContextOverride = Partial<Pick<SessionActionContext, 'startEdit'>>

export interface SessionMenuPreset<TItem> {
  getActions: (item: TItem, contextOverride?: SessionMenuActionContextOverride) => readonly ResolvedAction[]
  onAction: (
    item: TItem,
    action: ResolvedAction,
    contextOverride?: SessionMenuActionContextOverride
  ) => void | Promise<void>
}

export function useSessionMenuPreset<TItem>({
  getActionContext
}: {
  getActionContext: (item: TItem) => SessionActionContext
}): SessionMenuPreset<TItem> {
  const getActionContextWithOverride = useCallback(
    (item: TItem, contextOverride?: SessionMenuActionContextOverride) => ({
      ...getActionContext(item),
      ...contextOverride
    }),
    [getActionContext]
  )
  const getActions = useCallback(
    (item: TItem, contextOverride?: SessionMenuActionContextOverride) =>
      getSessionMenuActions(getActionContextWithOverride(item, contextOverride)) as ResolvedAction[],
    [getActionContextWithOverride]
  )
  const onAction = useCallback(
    async (item: TItem, action: ResolvedAction, contextOverride?: SessionMenuActionContextOverride) => {
      await runSessionMenuAction(
        action as ResolvedAction<SessionActionContext>,
        getActionContextWithOverride(item, contextOverride)
      )
    },
    [getActionContextWithOverride]
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
