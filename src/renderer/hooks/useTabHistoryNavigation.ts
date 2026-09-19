import type { RouterHistory } from '@tanstack/react-router'
import { useCallback, useEffect } from 'react'

import { useCommandHandler } from '@renderer/hooks/command'
import { goTabHistoryBack, goTabHistoryForward } from '@renderer/utils/tabHistoryNavigation'

const MOUSE_BACK_BUTTON = 3
const MOUSE_FORWARD_BUTTON = 4

const isWebviewEventTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('webview'))
}

/**
 * Active-tab entry points for the per-tab memory history stack: shortcut
 * commands plus mouse side buttons. Inactive tabs register disabled handlers
 * so only the focused tab can move.
 */
export const useTabHistoryNavigation = (history: RouterHistory, enabled: boolean): void => {
  const handleBack = useCallback(() => {
    goTabHistoryBack(history)
  }, [history])

  const handleForward = useCallback(() => {
    goTabHistoryForward(history)
  }, [history])

  useCommandHandler('tab.history.back', handleBack, { enabled })
  useCommandHandler('tab.history.forward', handleForward, { enabled })

  useEffect(() => {
    if (!enabled) return

    const onAuxClick = (event: MouseEvent) => {
      if (event.button !== MOUSE_BACK_BUTTON && event.button !== MOUSE_FORWARD_BUTTON) return
      if (isWebviewEventTarget(event.target)) return

      const moved = event.button === MOUSE_BACK_BUTTON ? goTabHistoryBack(history) : goTabHistoryForward(history)
      if (!moved) return

      event.preventDefault()
    }

    window.addEventListener('auxclick', onAuxClick)
    return () => window.removeEventListener('auxclick', onAuxClick)
  }, [enabled, history])
}
