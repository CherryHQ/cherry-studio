import { createContext, use } from 'react'
import type { RefObject } from 'react'

import type { AgentDetailsMode } from './agentSessionDetailsLayout'

export interface AgentSessionDetailsState {
  mode: AgentDetailsMode
  available: boolean
  inlineOpen: boolean
  popupOpen: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
  suppressCloseFocusRef: RefObject<boolean>
  measure: (width: number, height: number) => void
  setOpen: (open: boolean) => void
  openDetails: () => void
  dismissPopup: () => void
}

export const AgentSessionDetailsContext = createContext<AgentSessionDetailsState | null>(null)

export function useAgentSessionDetails() {
  const state = use(AgentSessionDetailsContext)
  if (!state) throw new Error('Session details require the Agent scope')
  return state
}
