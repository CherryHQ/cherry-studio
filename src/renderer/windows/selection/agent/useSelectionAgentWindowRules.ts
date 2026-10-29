import { useEffect, useEffectEvent } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { ipcApi } from '@renderer/ipc'

export interface SelectionAgentWindowRules {
  /** Closing loses nothing: an empty compose bar, or a settled turn without a draft. */
  idle: boolean
  /** Blur collapses it into a capsule: the turn is starting, running, or waiting on the user. */
  collapsible?: boolean
  pinned: boolean
  /** Runs on an Esc nothing else handled while the window is not idle, e.g. to stop the turn. */
  onEscape?: () => void
}

/**
 * Applies the window state rules. An idle window closes on Esc and, with auto-close on and unpinned,
 * on blur, where a collapsible one collapses instead; while also unpinned, main replaces an idle
 * window on the next selection trigger. `null` leaves the rules to the stage that owns them.
 */
export function useSelectionAgentWindowRules(rules: SelectionAgentWindowRules | null): void {
  const [isAutoClose] = usePreference('feature.selection.auto_close')
  const replaceable = rules ? rules.idle && !rules.pinned : null

  useEffect(() => {
    if (replaceable !== null) void ipcApi.request('selection.set_agent_window_replaceable', replaceable)
  }, [replaceable])

  const handleBlur = useEffectEvent(() => {
    if (!rules || !isAutoClose || rules.pinned) return
    if (rules.idle) void ipcApi.request('selection.dismiss_blurred_agent_window', 'close')
    else if (rules.collapsible) void ipcApi.request('selection.dismiss_blurred_agent_window', 'collapse')
  })
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!rules || event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
    if (rules.idle) void ipcApi.request('window.close')
    else rules.onEscape?.()
  })

  const enabled = rules !== null
  useEffect(() => {
    if (!enabled) return
    const onBlur = () => handleBlur()
    const onKeyDown = (event: KeyboardEvent) => handleKeyDown(event)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled, handleBlur, handleKeyDown])
}
