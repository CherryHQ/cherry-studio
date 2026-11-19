import { useCallback, useLayoutEffect, useRef } from 'react'

import { useOptionalRightPanelActions, useOptionalRightPanelState } from '../Shell'

/** Right-pane id of the Assistant / Agent profile, shared by both conversation pages. */
export const PROFILE_PANE_ID = 'profile'

export interface ProfilePaneToggle {
  active: boolean
  /** Stable across renders, so message headers can hold it without re-rendering. */
  toggle: () => void
}

/** Opens or closes the profile pane; null outside a conversation that offers one. */
export function useProfilePaneToggle(): ProfilePaneToggle | null {
  const state = useOptionalRightPanelState()
  const actions = useOptionalRightPanelActions()
  const active = state?.isActive(PROFILE_PANE_ID) ?? false
  const available = actions?.canOpen(PROFILE_PANE_ID) ?? false
  const latestRef = useRef({ active, actions })

  useLayoutEffect(() => {
    latestRef.current = { active, actions }
  }, [active, actions])

  const toggle = useCallback(() => {
    const { active: open, actions: panel } = latestRef.current
    if (open) panel?.close()
    else panel?.tryOpen(PROFILE_PANE_ID, { userInitiated: true })
  }, [])

  return available ? { active, toggle } : null
}
