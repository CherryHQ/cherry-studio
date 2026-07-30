import { cacheService } from '@data/CacheService'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { type TransientMiniApp, TransientMiniAppSchema } from '@shared/data/types/miniApp'

const MINI_APP_ROUTE_PREFIX = '/app/mini-app/'

/**
 * The descriptor a detached window needs to resolve this tab's mini app, or `undefined`
 * when the tab is not a mini app.
 *
 * A mini-app tab's route carries only the app id; the app itself is resolved from the
 * keep-alive cache, which is Memory-tier and therefore private to this window. A detached
 * window would find nothing there, so the descriptor has to travel with the tab.
 *
 * Read imperatively at detach time rather than mirrored into `tab.metadata`: the descriptor
 * holds a live URL (the OpenClaw dashboard embeds the gateway auth token) and tab metadata
 * is persisted to localStorage.
 *
 * Every `tab.detach` caller that detaches an *existing* tab must go through this — the tab
 * bar has two such paths (the context menu and the drag tear-off).
 */
export function transientMiniAppForTab(tab: Pick<Tab, 'url'>): TransientMiniApp | undefined {
  const app = cacheService
    .get('mini_app.opened_keep_alive')
    ?.find((candidate) => tab.url === `${MINI_APP_ROUTE_PREFIX}${candidate.appId}`)
  if (!app) return undefined
  // Parsed, not spread: keeps the payload to the declared fields and lets a
  // malformed cache entry degrade to a normal detach instead of failing it.
  return TransientMiniAppSchema.safeParse(app).data
}
