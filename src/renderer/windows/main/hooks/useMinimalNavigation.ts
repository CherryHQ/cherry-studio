import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { useTabs } from '@renderer/hooks/tab'
import type { MinimalHomeKind } from '@renderer/hooks/useMinimalMode'
import { findMinimalFeatureTab, getMinimalFeatureKey } from '@renderer/utils/minimalNavigation'

const HOME_URLS = { agent: '/app/agents', assistant: '/app/chat' } as const

export function useMinimalNavigation() {
  const [mode] = usePreference('ui.mode')
  const { tabs, activeTabId, setActiveTab, openTab, closeTabs } = useTabs()
  const [, setSplitOpen] = useCache('mini_app.split_open')
  const [, setSplitMiniAppId] = useCache('mini_app.split_id')
  const enabled = mode === 'minimal'
  const [homeKind, setHomeKind] = useState<MinimalHomeKind>('agent')
  const [homeTabIds, setHomeTabIds] = useState(() => ({
    agent: findMinimalFeatureTab(tabs, HOME_URLS.agent)?.id,
    assistant: findMinimalFeatureTab(tabs, HOME_URLS.assistant)?.id
  }))
  const isHome = tabs.some(
    (tab) =>
      tab.id === homeTabIds[homeKind] && tab.id === activeTabId && getMinimalFeatureKey(tab.url) === HOME_URLS[homeKind]
  )
  const wasEnabled = useRef(false)
  const pendingEfficiencyHomeId = useRef<string | null>(null)

  const switchHome = useCallback(
    (kind: MinimalHomeKind) => {
      const url = HOME_URLS[kind]
      const home =
        tabs.find((tab) => tab.id === homeTabIds[kind] && getMinimalFeatureKey(tab.url) === url) ??
        findMinimalFeatureTab(tabs, url)
      const id = home ? home.id : openTab(url)
      if (home) setActiveTab(home.id)
      setHomeTabIds((current) => (current[kind] === id ? current : { ...current, [kind]: id }))
      setHomeKind(kind)
      return id
    },
    [homeTabIds, openTab, setActiveTab, tabs]
  )

  const returnHome = useCallback(() => {
    switchHome(homeKind)
  }, [homeKind, switchHome])

  useLayoutEffect(() => {
    if (enabled && !wasEnabled.current) returnHome()
    if (!enabled && wasEnabled.current) pendingEfficiencyHomeId.current = switchHome('agent')
    wasEnabled.current = enabled

    const homeId = pendingEfficiencyHomeId.current
    if (!enabled && homeId && tabs.some((tab) => tab.id === homeId)) {
      pendingEfficiencyHomeId.current = null
      closeTabs(
        tabs.filter((tab) => tab.id !== homeId).map((tab) => tab.id),
        homeId
      )
      setActiveTab(homeId)
      setSplitOpen(false)
      setSplitMiniAppId('')
    }
  }, [closeTabs, enabled, returnHome, setActiveTab, setSplitMiniAppId, setSplitOpen, switchHome, tabs])

  const openFeature = useCallback(
    (url: string) => {
      const key = getMinimalFeatureKey(url)
      if (key === HOME_URLS.agent || key === HOME_URLS.assistant) {
        switchHome(key === HOME_URLS.agent ? 'agent' : 'assistant')
        return
      }
      const existing = findMinimalFeatureTab(tabs, url)
      if (existing) setActiveTab(existing.id)
      else openTab(url)
    },
    [openTab, switchHome, setActiveTab, tabs]
  )

  return useMemo(
    () => ({ enabled, isHome, homeKind, switchHome, returnHome, openFeature }),
    [enabled, isHome, homeKind, switchHome, returnHome, openFeature]
  )
}
