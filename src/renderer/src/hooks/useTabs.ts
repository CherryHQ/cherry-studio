import { useAppDispatch, useAppSelector } from '@renderer/store'
import type { Tab } from '@renderer/store/tabs'
import { addTab, removeTab, setActiveTab, updateTab } from '@renderer/store/tabs'
import { useNavigate } from 'react-router-dom'

export function useTabs() {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const tabs = useAppSelector((state) => state.tabs.tabs)
  const activeTabId = useAppSelector((state) => state.tabs.activeTabId)
  const activeTab = useAppSelector((state) => state.tabs.tabs.find((tab) => tab.id === activeTabId))

  const getTabId = (path: string): string => {
    if (path === '/') return 'home'
    const segments = path.split('/')
    return segments[1]
  }

  const shouldCreateTab = (path: string) => {
    if (path === '/') return false
    return !tabs.some((tab) => tab.id === getTabId(path))
  }

  const addNewTab = (tab: Tab) => {
    dispatch(addTab(tab))
    navigate(tab.path)
  }

  const closeTab = (tabId: string) => {
    if (tabs.length === 1) return

    if (tabId === activeTabId) {
      const remainingTabs = tabs.filter((tab) => tab.id !== tabId)
      const lastTab = remainingTabs[remainingTabs.length - 1]
      navigate(lastTab.path)
    }

    dispatch(removeTab(tabId))
  }

  const switchTab = (tabId: string) => {
    const tab = tabs.find((tab) => tab.id === tabId)
    if (tab) {
      dispatch(setActiveTab(tabId))
      navigate(tab.path)
    }
  }

  const updateCurrentTab = (updates: Partial<Tab>) => {
    dispatch(updateTab({ id: activeTabId, updates }))
  }

  return {
    tabs,
    activeTab,
    activeTabId,
    addNewTab,
    closeTab,
    switchTab,
    getTabId,
    shouldCreateTab,
    updateCurrentTab
  }
}
