import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { messageProjectionService } from '@renderer/services/aiTransport'

export function useAgentChildProjection(sessionId: string, toolCallId: string | undefined, active: boolean) {
  const target = useMemo(
    () => ({ kind: 'child' as const, sessionId, toolCallId: toolCallId ?? '' }),
    [sessionId, toolCallId]
  )
  const enabled = active && Boolean(toolCallId)
  const state = useSyncExternalStore(
    useCallback(
      (listener) => (enabled ? messageProjectionService.subscribe(target, listener) : () => {}),
      [enabled, target]
    ),
    useCallback(() => messageProjectionService.getSnapshot(target), [target])
  )
  return enabled ? { view: state.view?.kind === 'child' ? state.view : null, error: state.error } : undefined
}
