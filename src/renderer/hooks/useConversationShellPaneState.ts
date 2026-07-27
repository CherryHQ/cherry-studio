import { useCallback, useState } from 'react'

import type { PaneManualToggleSignal } from '../types/conversationLayout'
import { useWindowFrame } from './useWindowFrame'

interface UseConversationShellPaneStateOptions {
  isMessageOnlyView: boolean
  persistedPaneOpen: boolean
  setPersistedPaneOpen: (open: boolean) => void | Promise<unknown>
  onManualPaneOpen?: () => void
}

export function useConversationShellPaneState({
  isMessageOnlyView,
  persistedPaneOpen,
  setPersistedPaneOpen,
  onManualPaneOpen
}: UseConversationShellPaneStateOptions) {
  const isWindowFrame = useWindowFrame().mode === 'window'
  const [detachedPaneOpen, setDetachedPaneOpen] = useState(false)
  const [autoCollapsedPane, setAutoCollapsedPane] = useState(false)
  const [paneManualToggle, setPaneManualToggle] = useState<PaneManualToggleSignal>()
  const requestedPaneOpen = isWindowFrame ? detachedPaneOpen : persistedPaneOpen
  const shellPaneOpen = !isMessageOnlyView && requestedPaneOpen && !autoCollapsedPane

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

  const markManualPaneToggle = useCallback(
    (open: boolean) => {
      setPaneManualToggle((previous) => ({ seq: (previous?.seq ?? 0) + 1, open }))
      setShellPaneOpen(open)
    },
    [setShellPaneOpen]
  )

  const toggleShellPane = useCallback(() => {
    if (isMessageOnlyView) return

    const nextOpen = !shellPaneOpen
    markManualPaneToggle(nextOpen)
    if (nextOpen) onManualPaneOpen?.()
  }, [isMessageOnlyView, markManualPaneToggle, onManualPaneOpen, shellPaneOpen])

  const handlePaneAutoCollapseChange = useCallback((collapsed: boolean) => {
    setAutoCollapsedPane(collapsed)
  }, [])

  return {
    isWindowFrame,
    shellPaneOpen,
    paneManualToggle,
    setShellPaneOpen,
    markManualPaneToggle,
    toggleShellPane,
    handlePaneAutoCollapseChange
  }
}
