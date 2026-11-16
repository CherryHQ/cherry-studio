import { cacheService } from '@renderer/data/CacheService'
import { preferenceService } from '@renderer/data/PreferenceService'
import { normalizeBrowserUrl, sanitizeBrowserVisitUrl } from '@shared/utils/browserUrl'

export function getBrowserStartPageUrl(context: string): string {
  const mode = preferenceService.getCachedValue('app.browser.start_page.mode')
  let url: unknown
  if (mode === 'custom') url = preferenceService.getCachedValue('app.browser.start_page.custom_url')
  else if (mode === 'last') {
    const urls = cacheService.getPersist('ui.browser.last_urls')
    if (urls && typeof urls === 'object' && !Array.isArray(urls)) url = urls[context]
  }
  try {
    return typeof url === 'string' ? normalizeBrowserUrl(url) : 'about:blank'
  } catch {
    return 'about:blank'
  }
}

export function rememberBrowserPageUrl(context: string, value: string): void {
  if (preferenceService.getCachedValue('app.browser.start_page.mode') !== 'last') return
  const url = sanitizeBrowserVisitUrl(value)
  if (url === undefined) return
  cacheService.setPersist('ui.browser.last_urls', (urls) => ({
    ...(urls && typeof urls === 'object' && !Array.isArray(urls) ? urls : {}),
    [context]: url
  }))
}
