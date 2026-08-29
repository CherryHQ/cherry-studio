import { useTabs } from '@renderer/hooks/tab'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import type { SidebarShortcutItem } from '@shared/data/preference/preferenceTypes'
import { createSidebarShortcutId } from '@shared/data/preference/preferenceTypes'
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SidebarShortcutRegistry } from './registry'
import type { SidebarActivationGateway, SidebarShortcutResolution } from './types'

const RegistryContext = createContext<SidebarShortcutRegistry | null>(null)

export function SidebarShortcutRegistryProvider({
  registry,
  children
}: {
  registry: SidebarShortcutRegistry
  children: ReactNode
}) {
  return <RegistryContext value={registry}>{children}</RegistryContext>
}

export function useSidebarShortcutRegistry(): SidebarShortcutRegistry {
  const registry = use(RegistryContext)
  if (!registry) throw new Error('SidebarShortcutRegistryProvider is missing')
  return registry
}

export async function resolveSidebarShortcuts(
  shortcuts: readonly SidebarShortcutItem[],
  registry: SidebarShortcutRegistry
): Promise<SidebarShortcutResolution[]> {
  const byProvider = new Map<string, SidebarShortcutItem[]>()
  for (const shortcut of shortcuts) {
    const providerId = shortcut.target.locator.providerId
    const items = byProvider.get(providerId) ?? []
    items.push(shortcut)
    byProvider.set(providerId, items)
  }

  const resolvedById = new Map<string, SidebarShortcutResolution>()
  await Promise.all(
    [...byProvider.entries()].map(async ([providerId, items]) => {
      const provider = registry.get(providerId)
      const valid = provider ? items.filter((item) => provider.validate(item.target)) : []
      for (const item of items) {
        if (!provider || !provider.validate(item.target)) {
          resolvedById.set(item.id, { status: 'unavailable', shortcut: item })
        }
      }
      if (!provider || valid.length === 0) return

      try {
        const resources = await provider.resolveMany(valid.map((item) => item.target))
        for (const item of valid) {
          const resource = resources.get(createSidebarShortcutId(item.target))
          resolvedById.set(
            item.id,
            resource ? { status: 'resolved', shortcut: item, resource } : { status: 'missing', shortcut: item }
          )
        }
      } catch {
        for (const item of valid) resolvedById.set(item.id, { status: 'unavailable', shortcut: item })
      }
    })
  )
  return shortcuts.map((shortcut) => resolvedById.get(shortcut.id) ?? { status: 'unavailable', shortcut })
}

export function useResolvedSidebarShortcuts(
  shortcuts: readonly SidebarShortcutItem[],
  registry: SidebarShortcutRegistry
): SidebarShortcutResolution[] {
  const shortcutKey = shortcuts.map((shortcut) => `${shortcut.id}\u0001${shortcut.fallbackLabel ?? ''}`).join('\u0000')
  const [revision, setRevision] = useState(0)
  const [resolutions, setResolutions] = useState<SidebarShortcutResolution[]>(() =>
    shortcuts.map((shortcut) => ({ status: 'loading', shortcut }))
  )
  const generationRef = useRef(0)
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  useEffect(() => {
    const currentShortcuts = shortcutsRef.current
    const cleanups: Array<() => void> = []
    const targetsByProvider = new Map<string, SidebarShortcutItem[]>()
    for (const shortcut of currentShortcuts) {
      const items = targetsByProvider.get(shortcut.target.locator.providerId) ?? []
      items.push(shortcut)
      targetsByProvider.set(shortcut.target.locator.providerId, items)
    }
    for (const [providerId, items] of targetsByProvider) {
      const provider = registry.get(providerId)
      if (!provider?.subscribe) continue
      cleanups.push(
        provider.subscribe(
          items.map((item) => item.target),
          () => setRevision((value) => value + 1)
        )
      )
    }
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [registry, shortcutKey])

  useEffect(() => {
    const currentShortcuts = shortcutsRef.current
    const generation = ++generationRef.current
    setResolutions(currentShortcuts.map((shortcut) => ({ status: 'loading', shortcut })))
    void resolveSidebarShortcuts(currentShortcuts, registry).then((next) => {
      if (generationRef.current === generation) setResolutions(next)
    })
  }, [registry, revision, shortcutKey])

  return resolutions
}

export function useSidebarActivationGateway(): SidebarActivationGateway {
  const { activeTab, tabs, openTab, setActiveTab, updateTab } = useTabs()

  const openWorkspace = useCallback<SidebarActivationGateway['openWorkspace']>(
    (destination, options) => {
      if (!options?.inNewTab) {
        if (activeTab && destination.matchesCurrent?.(activeTab.url)) return
        const existing = tabs.find((tab) => tab.type === 'route' && tab.url === destination.url)
        if (existing) {
          setActiveTab(existing.id)
          return
        }
        if (activeTab && !activeTab.isPinned) {
          updateTab(activeTab.id, {
            url: destination.url,
            title: destination.title,
            icon: destination.icon,
            metadata: undefined
          })
          return
        }
      }
      openTab(destination.url, {
        forceNew: true,
        title: destination.title,
        icon: destination.icon
      })
    },
    [activeTab, openTab, setActiveTab, tabs, updateTab]
  )
  const openSettings = useCallback((path: string) => openRoute(path), [])

  return useMemo(() => ({ openWorkspace, openSettings }), [openSettings, openWorkspace])
}
