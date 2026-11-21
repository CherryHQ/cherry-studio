import { isAllowedMiniAppUrl, MINI_APP_WEB_URL_PROTOCOLS } from '@shared/data/api/schemas/miniApps'
import type { MiniApp } from '@shared/data/types/miniApp'
import { MINI_APP_REGIONS, type MiniAppCountry, type MiniAppRegionSelections } from '@shared/types/miniAppRegion'

export function isMiniAppRegionEligible(app: Pick<MiniApp, 'kind' | 'url'>): boolean {
  return app.kind === 'site' && isAllowedMiniAppUrl(app.url, MINI_APP_WEB_URL_PROTOCOLS)
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

export function isMiniAppRegionPartition(partition: string | undefined): boolean {
  return partition !== undefined && /^persist:webview-(?:region-v2:|us:|fake:)/i.test(partition)
}
