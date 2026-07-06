import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCallback } from 'react'

const RIGHT_PANE_OPEN_CACHE_KEY = {
  chat: 'ui.chat.right_pane_open',
  agent: 'ui.agent.right_pane_open'
} as const

/**
 * Classic-layout right-pane open state, cached per surface so the assistant (`'chat'`) and agent
 * surfaces never bleed into each other (mirrors the `ui.chat.*` vs `ui.agent.*` split used elsewhere).
 * The cache survives AgentChat draft→persistent remounts (each branch mounts its own Shell) and
 * app/page re-entry. In modern layout the pane is derived closed and the setter is a no-op, so the
 * stored value is only ever written from classic layout.
 */
export function useClassicLayoutRightPaneOpen(
  surface: 'chat' | 'agent',
  isClassicLayout: boolean
): readonly [boolean, (open: boolean) => void] {
  const [stored, setStored] = usePersistCache(RIGHT_PANE_OPEN_CACHE_KEY[surface])
  const paneOpen = isClassicLayout && stored
  const setPaneOpen = useCallback(
    (open: boolean) => {
      if (isClassicLayout) setStored(open)
    },
    [isClassicLayout, setStored]
  )
  return [paneOpen, setPaneOpen] as const
}
