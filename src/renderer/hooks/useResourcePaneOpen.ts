import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCallback } from 'react'

const RIGHT_PANE_OPEN_OVERRIDE_CACHE_KEY = {
  chat: 'ui.chat.right_pane_open_override',
  agent: 'ui.agent.right_pane_open_override'
} as const

interface ResourcePaneOpenOptions {
  enabled: boolean
  defaultOpen: boolean
}

type ResourcePaneOpenSetter = (open: boolean, options?: { force?: boolean }) => void

/**
 * Classic-layout right-pane state, cached independently for Chat and Agent. A null override delegates
 * to the page's position-derived default; an explicit boolean preserves the user's choice across page
 * re-entry and seeds the stable AgentChat shell. Outside classic layout the pane is derived closed and
 * normal writes are ignored.
 */
export function useResourcePaneOpen(
  surface: 'chat' | 'agent',
  { enabled, defaultOpen }: ResourcePaneOpenOptions
): readonly [boolean, ResourcePaneOpenSetter] {
  const [storedOverride, setStoredOverride] = usePersistCache(RIGHT_PANE_OPEN_OVERRIDE_CACHE_KEY[surface])
  const paneOpen = enabled && (storedOverride ?? defaultOpen)
  const setPaneOpen = useCallback<ResourcePaneOpenSetter>(
    (open, options) => {
      if (enabled || options?.force) setStoredOverride(open)
    },
    [enabled, setStoredOverride]
  )

  return [paneOpen, setPaneOpen] as const
}
