import type { MiniApp } from '@shared/data/types/miniApp'
import { MINI_APP_REGIONS, type MiniAppCountry, type MiniAppRegionSelections } from '@shared/types/miniAppRegion'

export function isMiniAppRegionEligible(app: Pick<MiniApp, 'kind' | 'url'>): boolean {
  return app.kind === 'site' && /^https?:\/\//i.test(app.url)
}

export function selectedMiniAppCountry(
  appId: string,
  selections: MiniAppRegionSelections,
  legacyAppIds: readonly string[],
  legacyCountry: MiniAppCountry
): MiniAppCountry | null {
  if (Object.hasOwn(selections, appId)) {
    const country = selections[appId]
    return country && Object.hasOwn(MINI_APP_REGIONS, country) ? country : null
  }
  return legacyAppIds.includes(appId) ? legacyCountry : null
}

export function getMiniAppRegionPartition(appId: string, country: MiniAppCountry): string {
  return country === 'US'
    ? `persist:webview-us:${encodeURIComponent(appId)}`
    : `persist:webview-fake:${country}:${encodeURIComponent(appId)}`
}
