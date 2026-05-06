import type { MiniApp, MiniAppRegion } from '@shared/data/types/miniApp'

/**
 * Shared test fixtures for MiniApp-related hooks.
 *
 * Provides factory functions to create MiniApp objects with sensible defaults,
 * eliminating duplication across useMiniApps and useMiniAppPopup test files.
 */

/**
 * Create a MiniApp with sensible defaults.
 *
 * @example
 * createMiniApp('app1')
 * createMiniApp('app1', { status: 'pinned', supportedRegions: ['Global'] })
 */
export const createMiniApp = (appId: string, overrides?: Partial<MiniApp>): MiniApp => ({
  appId: appId,
  name: appId,
  url: `https://${appId}.example.com`,
  kind: 'default',
  status: 'enabled',
  orderKey: 'a0',
  ...overrides
})

/** Shorthand: create a Global-supporting app */
export const createGlobalApp = (appId: string, overrides?: Partial<MiniApp>): MiniApp =>
  createMiniApp(appId, { supportedRegions: ['Global'] as MiniAppRegion[], ...overrides })

/** Shorthand: create a CN-only app */
export const createCnOnlyApp = (appId: string, overrides?: Partial<MiniApp>): MiniApp =>
  createMiniApp(appId, { supportedRegions: ['CN'] as MiniAppRegion[], ...overrides })

/**
 * Pre-built app sets for common test scenarios.
 */
export const appFixtures = {
  /** Three apps with different statuses */
  mixedStatus: {
    enabled1: createMiniApp('enabled1', { status: 'enabled' }),
    enabled2: createMiniApp('enabled2', { status: 'enabled' }),
    disabled1: createMiniApp('disabled1', { status: 'disabled' }),
    pinned1: createMiniApp('pinned1', { status: 'pinned' })
  },

  /** Three apps with different region support */
  mixedRegion: {
    globalApp: createGlobalApp('global-app'),
    cnOnlyApp: createCnOnlyApp('cn-app'),
    noRegionApp: createMiniApp('no-region-app')
  },

  /** Two apps for LRU eviction tests */
  twoApps: {
    app1: createMiniApp('app1'),
    app2: createMiniApp('app2')
  }
} as const
