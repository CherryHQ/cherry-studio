import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  closeTab,
  openTab,
  reopenClosedTab,
  switchTab,
  switchToNextTab,
  switchToPreviousTab
} from '@renderer/store/tabs'
import { useEffect } from 'react'

export const useTabShortcuts = () => {
  const dispatch = useAppDispatch()
  const { tabs, tabOrder, activeTabId } = useAppSelector((state) => state.tabs)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey

      // Ctrl/Cmd + T: New tab
      if (isMod && e.key === 't' && !e.shiftKey) {
        e.preventDefault()
        dispatch(
          openTab({
            type: 'page',
            route: '/',
            title: 'Home',
            canClose: true,
            isPinned: false
          })
        )
        return
      }

      // Ctrl/Cmd + W: Close current tab
      if (isMod && e.key === 'w') {
        e.preventDefault()
        if (activeTabId) {
          const activeTab = tabs.find((t) => t.id === activeTabId)
          if (activeTab?.canClose) {
            dispatch(closeTab(activeTabId))
          }
        }
        return
      }

      // Ctrl/Cmd + Shift + T: Reopen closed tab
      if (isMod && e.shiftKey && e.key === 't') {
        e.preventDefault()
        dispatch(reopenClosedTab())
        return
      }

      // Ctrl/Cmd + Tab: Next tab
      if (isMod && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        dispatch(switchToNextTab())
        return
      }

      // Ctrl/Cmd + Shift + Tab: Previous tab
      if (isMod && e.shiftKey && e.key === 'Tab') {
        e.preventDefault()
        dispatch(switchToPreviousTab())
        return
      }

      // Ctrl/Cmd + 1-9: Switch to tab by index
      if (isMod && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const tabIndex = parseInt(e.key) - 1
        if (tabOrder[tabIndex]) {
          dispatch(switchTab(tabOrder[tabIndex]))
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch, tabs, tabOrder, activeTabId])
}
