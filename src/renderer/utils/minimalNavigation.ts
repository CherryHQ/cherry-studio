import type { Tab } from '@shared/data/cache/cacheValueTypes'

export function getMinimalFeatureKey(url: string): string {
  const parsed = new URL(url, 'https://www.cherry-ai.com')
  if (parsed.pathname.startsWith('/settings')) return '/settings'
  if (parsed.pathname.startsWith('/app/mini-app/')) return parsed.pathname
  const base = parsed.pathname.split('/').slice(0, 3).join('/')
  return base === '/app/code' ? `${base}?tool=${parsed.searchParams.get('tool') ?? ''}` : base
}

export function findMinimalFeatureTab(tabs: readonly Tab[], url: string): Tab | undefined {
  const key = getMinimalFeatureKey(url)
  return tabs.reduce<Tab | undefined>((latest, tab) => {
    if (tab.type !== 'route' || getMinimalFeatureKey(tab.url) !== key) return latest
    return !latest || (tab.lastAccessTime ?? 0) > (latest.lastAccessTime ?? 0) ? tab : latest
  }, undefined)
}
