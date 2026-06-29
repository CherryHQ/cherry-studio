import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import i18n from '@renderer/i18n'
import { OPEN_SETTINGS_TAB_EVENT, type OpenSettingsTabEvent } from '@renderer/services/settingsNavigation'
import { normalizeSettingsPath, type SettingsPath } from '@shared/data/types/settingsPath'
import type { MainWindowInitData } from '@shared/types/mainWindow'
import { useCallback, useEffect, useRef } from 'react'

import { useTabs } from './useTabs'

function isSettingsTabUrl(url: string) {
  return url === '/settings' || url.startsWith('/settings/') || url.startsWith('/settings?')
}

function useOpenSettingsRoute() {
  const { tabs, openTab, setActiveTab, updateTab } = useTabs()
  const settingsTabIdRef = useRef<string | null>(null)
  const pendingSettingsPathRef = useRef<SettingsPath | null>(null)

  useEffect(() => {
    const settingsTab = tabs.find((tab) => tab.type === 'route' && isSettingsTabUrl(tab.url))

    if (!settingsTab) {
      settingsTabIdRef.current = null
      return
    }

    settingsTabIdRef.current = settingsTab.id

    const pendingPath = pendingSettingsPathRef.current
    if (!pendingPath) {
      return
    }

    pendingSettingsPathRef.current = null
    updateTab(settingsTab.id, {
      url: pendingPath,
      title: i18n.t('settings.title'),
      lastAccessTime: Date.now()
    })
    setActiveTab(settingsTab.id)
  }, [tabs, setActiveTab, updateTab])

  return useCallback(
    (path: SettingsPath) => {
      const targetPath = normalizeSettingsPath(path)
      const title = i18n.t('settings.title')
      const settingsTab = tabs.find((tab) => tab.type === 'route' && isSettingsTabUrl(tab.url))

      if (settingsTab) {
        updateTab(settingsTab.id, {
          url: targetPath,
          title,
          lastAccessTime: Date.now()
        })
        setActiveTab(settingsTab.id)
        return
      }

      if (settingsTabIdRef.current) {
        pendingSettingsPathRef.current = targetPath
        return
      }

      const settingsTabId = openTab(targetPath, { title })
      settingsTabIdRef.current = settingsTabId
    },
    [tabs, openTab, setActiveTab, updateTab]
  )
}

function useSettingsTabEventBridge(openSettingsRoute: (path: SettingsPath) => void) {
  useEffect(() => {
    const handleOpenSettingsTab = (event: Event) => {
      event.preventDefault()
      openSettingsRoute((event as OpenSettingsTabEvent).detail.path)
    }

    window.addEventListener(OPEN_SETTINGS_TAB_EVENT, handleOpenSettingsTab)
    return () => {
      window.removeEventListener(OPEN_SETTINGS_TAB_EVENT, handleOpenSettingsTab)
    }
  }, [openSettingsRoute])
}

export function useMainSettingsTab() {
  const openSettingsRoute = useOpenSettingsRoute()
  const initData = useWindowInitData<MainWindowInitData>()

  useEffect(() => {
    if (initData?.kind === 'settings-navigation') {
      openSettingsRoute(initData.path)
    }
  }, [initData, openSettingsRoute])

  useSettingsTabEventBridge(openSettingsRoute)
}
