import type { PaneManualToggleSignal } from '@renderer/types/conversationLayout'
import { useCallback, useState } from 'react'

import { useWindowFrame } from './useWindowFrame'

interface UseConversationShellPaneStateOptions {
  persistedPaneOpen: boolean
  setPersistedPaneOpen: (open: boolean) => void | Promise<unknown>
  onManualPaneOpen?: () => void
}

export function useConversationShellPaneState({
  persistedPaneOpen,
  setPersistedPaneOpen,
  onManualPaneOpen
}: UseConversationShellPaneStateOptions) {
  const isWindowFrame = useWindowFrame().mode === 'window'
  const [detachedPaneOpen, setDetachedPaneOpen] = useState(false)
  const [autoCollapsedPane, setAutoCollapsedPane] = useState(false)
  const [paneManualToggle, setPaneManualToggle] = useState<PaneManualToggleSignal>()
  const requestedPaneOpen = isWindowFrame ? detachedPaneOpen : persistedPaneOpen
  const shellPaneOpen = requestedPaneOpen && !autoCollapsedPane

  const setShellPaneOpen = useCallback(
    (open: boolean) => {
      setAutoCollapsedPane(false)
      if (isWindowFrame) {
        setDetachedPaneOpen(open)
        return
      }
      void setPersistedPaneOpen(open)
    },
    [isWindowFrame, setPersistedPaneOpen]
  )

  const setShellPaneOpenManually = useCallback(
    (open: boolean) => {
      setPaneManualToggle((previous) => ({ seq: (previous?.seq ?? 0) + 1, open }))
      setShellPaneOpen(open)
    },
    [setShellPaneOpen]
  )

  const toggleShellPane = useCallback(() => {
    const nextOpen = !shellPaneOpen
    setShellPaneOpenManually(nextOpen)
    if (nextOpen) onManualPaneOpen?.()
  }, [onManualPaneOpen, setShellPaneOpenManually, shellPaneOpen])

  const handlePaneAutoCollapseChange = useCallback((collapsed: boolean) => {
    setAutoCollapsedPane(collapsed)
  }, [])

  return {
    isWindowFrame,
    shellPaneOpen,
    paneManualToggle,
    setShellPaneOpen,
    setShellPaneOpenManually,
    toggleShellPane,
    handlePaneAutoCollapseChange
  }
}
