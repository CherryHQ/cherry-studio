import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCallback } from 'react'

const RIGHT_PANE_OPEN_CACHE_KEY = {
  chat: 'ui.chat.right_pane_open',
  agent: 'ui.agent.right_pane_open'
} as const

interface ClassicLayoutRightPaneOpenOptions {
  enabled: boolean
  defaultOpen: boolean
}

type ClassicLayoutPaneOpenSetter = (open: boolean, options?: { force?: boolean }) => void

/**
 * Classic-layout right-pane state, cached independently for Chat and Agent. A null value delegates
 * to the page's position-derived default; an explicit boolean preserves the user's choice across page
 * re-entry. Outside classic layout the pane is derived closed and normal writes are ignored.
 */
export function useClassicLayoutRightPaneOpen(
  surface: 'chat' | 'agent',
  { enabled, defaultOpen }: ClassicLayoutRightPaneOpenOptions
): readonly [boolean, ClassicLayoutPaneOpenSetter] {
  const [stored, setStored] = usePersistCache(RIGHT_PANE_OPEN_CACHE_KEY[surface])
  const paneOpen = enabled && (stored ?? defaultOpen)
  const setPaneOpen = useCallback<ClassicLayoutPaneOpenSetter>(
    (open, options) => {
      if (enabled || options?.force) setStored(open)
    },
    [enabled, setStored]
  )

  return [paneOpen, setPaneOpen] as const
}
