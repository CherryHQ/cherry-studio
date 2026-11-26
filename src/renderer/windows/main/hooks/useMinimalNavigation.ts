import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { useTabs } from '@renderer/hooks/tab'
import { findMinimalFeatureTab, getMinimalFeatureKey } from '@renderer/utils/minimalNavigation'

const HOME_URL = '/app/agents'

export function useMinimalNavigation() {
  const [mode] = usePreference('ui.mode')
  const { tabs, activeTabId, setActiveTab, openTab, closeTabs } = useTabs()
  const [, setSplit] = useCache('mini_app.split')
  const enabled = mode === 'minimal'
  const [rememberedHomeTabId, setHomeTabId] = useState(() => findMinimalFeatureTab(tabs, HOME_URL)?.id)
  const homeTab = tabs.find((tab) => tab.id === rememberedHomeTabId && getMinimalFeatureKey(tab.url) === HOME_URL)
  const homeTabId = homeTab?.id
  const isHome = homeTabId !== undefined && homeTabId === activeTabId
  const wasEnabled = useRef(false)
  const pendingEfficiencyHomeId = useRef<string | null>(null)

  const returnHome = useCallback(() => {
    const home = homeTab ?? findMinimalFeatureTab(tabs, HOME_URL)
    const id = home?.id ?? openTab(HOME_URL)
    if (home) setActiveTab(home.id)
    setHomeTabId(id)
    return id
  }, [homeTab, openTab, setActiveTab, tabs])

  useLayoutEffect(() => {
    if (enabled && !wasEnabled.current) returnHome()
    if (!enabled && wasEnabled.current) pendingEfficiencyHomeId.current = returnHome()
    wasEnabled.current = enabled

    const homeId = pendingEfficiencyHomeId.current
    if (!enabled && homeId && tabs.some((tab) => tab.id === homeId)) {
      pendingEfficiencyHomeId.current = null
      closeTabs(
        tabs.filter((tab) => tab.id !== homeId).map((tab) => tab.id),
        homeId
      )
      setActiveTab(homeId)
      setSplit(null)
    }
  }, [closeTabs, enabled, returnHome, setActiveTab, setSplit, tabs])

  const openFeature = useCallback(
    (url: string) => {
      const key = getMinimalFeatureKey(url)
      if (key === HOME_URL) {
        returnHome()
        return
      }
      const existing = findMinimalFeatureTab(tabs, url)
      if (existing) setActiveTab(existing.id)
      else openTab(url)
    },
    [openTab, returnHome, setActiveTab, tabs]
  )

  return useMemo(
    () => ({ enabled, isHome, homeTabId, returnHome, openFeature }),
    [enabled, isHome, homeTabId, returnHome, openFeature]
  )
}
