import type { Tab } from '@shared/data/cache/cacheValueTypes'

export const DEFAULT_MAX_KEEP_ALIVE_MINI_APPS = 10

export const MINI_APP_ROUTE_PREFIX = '/app/mini-app/'

export function miniAppIdFromTabUrl(url: string | undefined): string | null {
  if (!url?.startsWith(MINI_APP_ROUTE_PREFIX)) return null
  const id = url.slice(MINI_APP_ROUTE_PREFIX.length).split(/[/?#]/, 1)[0]
  return id || null
}

export function canPresentMiniAppSplit(primary: Tab, secondary?: Tab): boolean {
  const primaryId = miniAppIdFromTabUrl(primary.url)
  return (
    primaryId !== null &&
    (!secondary || (miniAppIdFromTabUrl(secondary.url) !== null && miniAppIdFromTabUrl(secondary.url) !== primaryId))
  )
}
