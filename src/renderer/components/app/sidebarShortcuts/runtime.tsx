import { useTabs } from '@renderer/hooks/tab'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { miniAppIdFromTabUrl } from '@renderer/utils/miniAppKeepAlive'
import type { SidebarShortcutItem } from '@shared/data/preference/preferenceTypes'
import { createSidebarShortcutId } from '@shared/data/preference/preferenceTypes'
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SidebarShortcutRegistry } from './registry'
import type { SidebarActivationGateway, SidebarShortcutProvider, SidebarShortcutResolution } from './types'

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

interface ProviderShortcutGroup {
  key: string
  items: SidebarShortcutItem[]
}

interface ProviderSubscription {
  key: string
  provider: SidebarShortcutProvider
  cleanup: () => void
}

function groupShortcutsByProvider(shortcuts: readonly SidebarShortcutItem[]): Map<string, ProviderShortcutGroup> {
  const itemsByProvider = new Map<string, SidebarShortcutItem[]>()
  for (const shortcut of shortcuts) {
    const providerId = shortcut.target.locator.providerId
    const items = itemsByProvider.get(providerId) ?? []
    items.push(shortcut)
    itemsByProvider.set(providerId, items)
  }
  return new Map(
    [...itemsByProvider].map(([providerId, items]) => [
      providerId,
      {
        key: items
          .map((item) => item.id)
          .toSorted()
          .join('\u0000'),
        items
      }
    ])
  )
}

function withCurrentShortcut(
  resolution: SidebarShortcutResolution,
  shortcut: SidebarShortcutItem
): SidebarShortcutResolution {
  return resolution.shortcut.fallbackLabel === shortcut.fallbackLabel ? resolution : { ...resolution, shortcut }
}

export function useResolvedSidebarShortcuts(
  shortcuts: readonly SidebarShortcutItem[],
  registry: SidebarShortcutRegistry
): SidebarShortcutResolution[] {
  const groups = useMemo(() => groupShortcutsByProvider(shortcuts), [shortcuts])
  const [resolutionsById, setResolutionsById] = useState<ReadonlyMap<string, SidebarShortcutResolution>>(
    () => new Map()
  )
  const mountedRef = useRef(true)
  const registryRef = useRef(registry)
  const shortcutsRef = useRef(shortcuts)
  const groupsRef = useRef(groups)
  const resolvedGroupKeysRef = useRef(new Map<string, string>())
  const generationsRef = useRef(new Map<string, number>())
  const subscriptionsRef = useRef(new Map<string, ProviderSubscription>())
  const resolveProviderRef = useRef<(providerId: string, group: ProviderShortcutGroup) => void>(() => {})
  shortcutsRef.current = shortcuts
  groupsRef.current = groups

  const resolveProvider = useCallback(
    (providerId: string, group: ProviderShortcutGroup) => {
      const generation = (generationsRef.current.get(providerId) ?? 0) + 1
      generationsRef.current.set(providerId, generation)
      void resolveSidebarShortcuts(group.items, registry).then((next) => {
        const currentGroup = groupsRef.current.get(providerId)
        if (
          !mountedRef.current ||
          generationsRef.current.get(providerId) !== generation ||
          currentGroup?.key !== group.key
        ) {
          return
        }
        setResolutionsById((current) => {
          const updated = new Map(current)
          for (const resolution of next) updated.set(resolution.shortcut.id, resolution)
          return updated
        })
      })
    },
    [registry]
  )
  resolveProviderRef.current = resolveProvider

  useEffect(() => {
    if (registryRef.current !== registry) {
      registryRef.current = registry
      resolvedGroupKeysRef.current.clear()
      for (const providerId of generationsRef.current.keys()) {
        generationsRef.current.set(providerId, (generationsRef.current.get(providerId) ?? 0) + 1)
      }
    }

    const currentIds = new Set(shortcutsRef.current.map((shortcut) => shortcut.id))
    setResolutionsById((current) => {
      if ([...current.keys()].every((id) => currentIds.has(id))) return current
      return new Map([...current].filter(([id]) => currentIds.has(id)))
    })

    for (const providerId of resolvedGroupKeysRef.current.keys()) {
      if (groups.has(providerId)) continue
      resolvedGroupKeysRef.current.delete(providerId)
      generationsRef.current.set(providerId, (generationsRef.current.get(providerId) ?? 0) + 1)
    }
    for (const [providerId, group] of groups) {
      if (resolvedGroupKeysRef.current.get(providerId) === group.key) continue
      resolvedGroupKeysRef.current.set(providerId, group.key)
      resolveProvider(providerId, group)
    }

    for (const [providerId, subscription] of subscriptionsRef.current) {
      const group = groups.get(providerId)
      const provider = registry.get(providerId)
      if (group && provider?.subscribe && subscription.key === group.key && subscription.provider === provider) {
        continue
      }
      subscription.cleanup()
      subscriptionsRef.current.delete(providerId)
    }
    for (const [providerId, group] of groups) {
      const provider = registry.get(providerId)
      if (!provider?.subscribe || subscriptionsRef.current.has(providerId)) continue
      const cleanup = provider.subscribe(
        group.items.map((item) => item.target),
        () => {
          const currentGroup = groupsRef.current.get(providerId)
          if (currentGroup) resolveProviderRef.current(providerId, currentGroup)
        }
      )
      subscriptionsRef.current.set(providerId, { key: group.key, provider, cleanup })
    }
  }, [groups, registry, resolveProvider])

  useEffect(() => {
    mountedRef.current = true
    const subscriptions = subscriptionsRef.current
    return () => {
      mountedRef.current = false
      for (const subscription of subscriptions.values()) subscription.cleanup()
      subscriptions.clear()
    }
  }, [])

  return shortcuts.map((shortcut) => {
    const resolution = resolutionsById.get(shortcut.id)
    return resolution ? withCurrentShortcut(resolution, shortcut) : { status: 'loading', shortcut }
  })
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
          if (miniAppIdFromTabUrl(activeTab.url)) {
            openTab(destination.url, {
              title: destination.title,
              icon: destination.icon
            })
            return
          }
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
