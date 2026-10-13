import { useCallback, useMemo } from 'react'

import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import {
  executeSessionMenuAction,
  resolveSessionMenuActions,
  type SessionActionContext
} from '@renderer/components/chat/actions/sessionItemActions'
import { useSidebarAvailable } from '@renderer/hooks/useSidebarAvailable'

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
  const sidebarAvailable = useSidebarAvailable()
  const getActionContextWithOverride = useCallback(
    (item: TItem, contextOverride?: SessionMenuActionContextOverride) => {
      const context = { ...getActionContext(item), ...contextOverride }
      return { ...context, onToggleSidebar: sidebarAvailable ? context.onToggleSidebar : undefined }
    },
    [getActionContext, sidebarAvailable]
  )
  const getActions = useCallback(
    (item: TItem, contextOverride?: SessionMenuActionContextOverride) =>
      getSessionMenuActions(getActionContextWithOverride(item, contextOverride)) as ResolvedAction[],
    [getActionContextWithOverride]
  )
  const onAction = useCallback(
    async (item: TItem, action: ResolvedAction, contextOverride?: SessionMenuActionContextOverride) => {
      await runSessionMenuAction(action, getActionContextWithOverride(item, contextOverride))
    },
    [getActionContextWithOverride]
  )

  return useMemo(() => ({ getActions, onAction }), [getActions, onAction])
}

export function useSessionMenuActions(actionContext: SessionActionContext) {
  const sidebarAvailable = useSidebarAvailable()
  const context = useMemo(
    () => ({ ...actionContext, onToggleSidebar: sidebarAvailable ? actionContext.onToggleSidebar : undefined }),
    [actionContext, sidebarAvailable]
  )
  const getActions = useCallback(() => getSessionMenuActions(context), [context])
  const handleMenuAction = useCallback(
    async (action: ResolvedAction<SessionActionContext>) => {
      await runSessionMenuAction(action, context)
    },
    [context]
  )

  return { getActions, handleMenuAction }
}
