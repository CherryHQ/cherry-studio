import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { useTabs } from '@renderer/hooks/tab'
import { findMinimalFeatureTab, getMinimalFeatureKey } from '@renderer/utils/minimalNavigation'

export function useMinimalNavigation() {
  const [mode] = usePreference('ui.mode')
  const { tabs, activeTabId, setActiveTab, openTab } = useTabs()
  const enabled = mode === 'minimal'
  const [homeTabId, setHomeTabId] = useState<string | undefined>(() => findMinimalFeatureTab(tabs, '/app/agents')?.id)
  const homeTab = tabs.find((tab) => tab.id === homeTabId && getMinimalFeatureKey(tab.url) === '/app/agents')
  const isHome = !!homeTab && activeTabId === homeTab.id
  const wasEnabled = useRef(false)

  const returnHome = useCallback(() => {
    const home = homeTab ?? findMinimalFeatureTab(tabs, '/app/agents')
    if (home) {
      setHomeTabId(home.id)
      setActiveTab(home.id)
    } else {
      setHomeTabId(openTab('/app/agents'))
    }
  }, [homeTab, openTab, setActiveTab, tabs])

  useLayoutEffect(() => {
    if (enabled && !wasEnabled.current) returnHome()
    wasEnabled.current = enabled
  }, [enabled, returnHome])

  const openFeature = useCallback(
    (url: string) => {
      if (getMinimalFeatureKey(url) === '/app/agents') {
        returnHome()
        return
      }
      const existing = findMinimalFeatureTab(tabs, url)
      if (existing) setActiveTab(existing.id)
      else openTab(url)
    },
    [openTab, returnHome, setActiveTab, tabs]
  )

  return useMemo(() => ({ enabled, isHome, returnHome, openFeature }), [enabled, isHome, returnHome, openFeature])
}
