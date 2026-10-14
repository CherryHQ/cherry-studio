/**
 * Navigation containment.
 *
 * The network allowlist is meaningless without this: an app that can navigate
 * itself to an arbitrary page simply leaves the policed partition behind.
 */

import { loggerService } from '@logger'
import { MINI_APP_SCHEME } from '@shared/types/miniAppManifest'

const logger = loggerService.withContext('miniAppNavigation')

export function shouldAllowNavigation(url: string, appId: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === `${MINI_APP_SCHEME}:` && parsed.host === appId
  } catch {
    return false
  }
}

export function installNavigationPolicy(contents: Electron.WebContents, appId: string): void {
  contents.on('will-navigate', (event: Electron.Event, url: string) => {
    if (shouldAllowNavigation(url, appId)) return
    logger.warn('Blocked mini app navigation', { appId, url })
    event.preventDefault()
  })

  // Popups are denied outright: a new window would be outside every policy
  // installed on this partition.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
