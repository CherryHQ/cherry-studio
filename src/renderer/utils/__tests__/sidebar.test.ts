import type { SidebarFavorite, SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import {
  getOrderedLaunchpadApps,
  getOrderedVisibleSidebarFavoriteItems,
  getOrderedVisibleSidebarFavorites,
  getSidebarFavoriteItems,
  getSidebarMenuPath,
  getSidebarMiniAppFavoriteIds,
  removeSidebarMiniApp,
  reorderLaunchpadApps,
  reorderSidebarFavorites,
  resolveSidebarActiveItem,
  setSidebarAppPinned,
  SIDEBAR_FAVORITE_ORDER,
  toggleSidebarMiniApp
} from '../sidebar'

const appFavorite = (id: SidebarFavorite): SidebarFavoriteItem => ({ type: 'app', id })
const miniAppFavorite = (id: string): SidebarFavoriteItem => ({ type: 'mini_app', id })

describe('sidebar config helpers', () => {
  it('keeps the fixed sidebar app order available', () => {
    expect(SIDEBAR_FAVORITE_ORDER.slice(0, 5)).toEqual(['assistants', 'agents', 'paintings', 'translate', 'mini_app'])
  })

  it('preserves the preference order when reading ordered visible sidebar favorites', () => {
    expect(
      getOrderedVisibleSidebarFavorites([appFavorite('translate'), appFavorite('assistants'), appFavorite('agents')])
    ).toEqual(['translate', 'assistants', 'agents'])
  })

  it('sanitizes ordered visible sidebar favorites and keeps required favorites visible', () => {
    expect(
      getOrderedVisibleSidebarFavorites([
        appFavorite('translate'),
        { type: 'app', id: 'unknown' } as never,
        appFavorite('translate'),
        appFavorite('agents')
      ])
    ).toEqual(['assistants', 'translate', 'agents'])
  })

  it('ignores mini app favorites when reading system sidebar favorites', () => {
    expect(
      getOrderedVisibleSidebarFavorites([
        appFavorite('translate'),
        miniAppFavorite('calculator'),
        appFavorite('assistants'),
        appFavorite('agents')
      ])
    ).toEqual(['translate', 'assistants', 'agents'])
  })

  it('returns the full mixed list interleaved in stored order with required apps forced in', () => {
    expect(
      getOrderedVisibleSidebarFavoriteItems([
        appFavorite('translate'),
        miniAppFavorite('calculator'),
        appFavorite('agents')
      ])
    ).toEqual([
      appFavorite('assistants'),
      appFavorite('translate'),
      miniAppFavorite('calculator'),
      appFavorite('agents')
    ])
  })

  it('does not prepend a required app that is already present at any position', () => {
    expect(getOrderedVisibleSidebarFavoriteItems([miniAppFavorite('calculator'), appFavorite('assistants')])).toEqual([
      miniAppFavorite('calculator'),
      appFavorite('assistants')
    ])
  })

  it('reads mini app favorite ids from typed sidebar favorites', () => {
    expect(
      getSidebarMiniAppFavoriteIds([
        appFavorite('translate'),
        miniAppFavorite('calculator'),
        appFavorite('assistants'),
        miniAppFavorite('calculator'),
        miniAppFavorite('weather')
      ])
    ).toEqual(['calculator', 'weather'])
  })

  it('dedupes favorites and drops unknown app favorites', () => {
    expect(
      getSidebarFavoriteItems([
        appFavorite('translate'),
        miniAppFavorite('calculator'),
        appFavorite('assistants'),
        miniAppFavorite('calculator'),
        { type: 'app', id: 'unknown' } as never
      ])
    ).toEqual([appFavorite('translate'), miniAppFavorite('calculator'), appFavorite('assistants')])
  })

  it('drops unknown favorite types from visible reads while keeping surrounding leaves', () => {
    const group = { type: 'group', id: 'g1', name: 'Group', items: [] } as unknown as SidebarFavoriteItem

    expect(getSidebarFavoriteItems([appFavorite('translate'), group, miniAppFavorite('calculator')])).toEqual([
      appFavorite('translate'),
      miniAppFavorite('calculator')
    ])
  })

  it('preserves extra per-item fields through normalization (non-lossy round-trip)', () => {
    // Future per-item params must survive the normalize round-trip instead of being
    // rebuilt away from just the id.
    const appWithExtra = { type: 'app', id: 'assistants', badge: 3 } as unknown as SidebarFavoriteItem
    const miniWithExtra = { type: 'mini_app', id: 'calculator', color: '#fff' } as unknown as SidebarFavoriteItem

    expect(getSidebarFavoriteItems([appWithExtra, miniWithExtra])).toEqual([
      { type: 'app', id: 'assistants', badge: 3 },
      { type: 'mini_app', id: 'calculator', color: '#fff' }
    ])
  })

  it('resolves menu paths and active items with the paintings provider route', () => {
    expect(getSidebarMenuPath('paintings', 'zhipu')).toBe('/app/paintings/zhipu')
    expect(resolveSidebarActiveItem('/app/paintings/zhipu')).toBe('paintings')
  })

  it('resolves the active item for query-keyed conversation routes', () => {
    expect(resolveSidebarActiveItem('/app/chat?topicId=abc')).toBe('assistants')
    expect(resolveSidebarActiveItem('/app/agents?sessionId=xyz')).toBe('agents')
  })

  it('does not mark the launchpad sidebar item active for concrete mini app routes', () => {
    expect(resolveSidebarActiveItem('/app/mini-app')).toBe('mini_app')
    expect(resolveSidebarActiveItem('/app/mini-app/qwen')).toBe('')
  })
})

describe('sidebar favorites mutations', () => {
  it('pins an app to the very end of the mixed list', () => {
    expect(setSidebarAppPinned([appFavorite('assistants'), miniAppFavorite('calculator')], 'knowledge', true)).toEqual([
      appFavorite('assistants'),
      miniAppFavorite('calculator'),
      appFavorite('knowledge')
    ])
  })

  it('unpins an app while preserving mini apps', () => {
    expect(
      setSidebarAppPinned(
        [appFavorite('assistants'), appFavorite('knowledge'), miniAppFavorite('calculator')],
        'knowledge',
        false
      )
    ).toEqual([appFavorite('assistants'), miniAppFavorite('calculator')])
  })

  it('never unpins a required app', () => {
    expect(setSidebarAppPinned([appFavorite('assistants'), appFavorite('knowledge')], 'assistants', false)).toEqual([
      appFavorite('assistants'),
      appFavorite('knowledge')
    ])
  })

  it('toggles a mini app on and off, preserving apps', () => {
    const added = toggleSidebarMiniApp([appFavorite('assistants'), miniAppFavorite('calculator')], 'weather')
    expect(added).toEqual([appFavorite('assistants'), miniAppFavorite('calculator'), miniAppFavorite('weather')])
    expect(toggleSidebarMiniApp(added, 'calculator')).toEqual([appFavorite('assistants'), miniAppFavorite('weather')])
  })

  it('removes a mini app while preserving apps and other mini apps', () => {
    expect(
      removeSidebarMiniApp(
        [appFavorite('assistants'), miniAppFavorite('calculator'), miniAppFavorite('weather')],
        'calculator'
      )
    ).toEqual([appFavorite('assistants'), miniAppFavorite('weather')])
  })

  it('preserves forward-compatible unknown items when mutating favorites', () => {
    const group = {
      type: 'group',
      id: 'g1',
      name: 'Group',
      items: [miniAppFavorite('calculator')]
    } as unknown as SidebarFavoriteItem

    expect(toggleSidebarMiniApp([appFavorite('assistants'), group], 'weather')).toEqual([
      appFavorite('assistants'),
      miniAppFavorite('weather'),
      group
    ])
  })
})

describe('reorderSidebarFavorites (mixed cross-type reorder)', () => {
  it('reorders apps and mini apps together into any interleaved order', () => {
    expect(
      reorderSidebarFavorites(
        [appFavorite('assistants'), appFavorite('knowledge'), miniAppFavorite('calculator')],
        [miniAppFavorite('calculator'), appFavorite('assistants'), appFavorite('knowledge')]
      )
    ).toEqual([miniAppFavorite('calculator'), appFavorite('assistants'), appFavorite('knowledge')])
  })

  it('keeps stored favorites missing from a partial order at the end', () => {
    expect(
      reorderSidebarFavorites(
        [appFavorite('assistants'), miniAppFavorite('calculator'), miniAppFavorite('stale')],
        [miniAppFavorite('calculator'), appFavorite('assistants')]
      )
    ).toEqual([miniAppFavorite('calculator'), appFavorite('assistants'), miniAppFavorite('stale')])
  })

  it('drops requested items that are not stored favorites', () => {
    expect(
      reorderSidebarFavorites(
        [appFavorite('assistants'), miniAppFavorite('calculator')],
        [miniAppFavorite('ghost'), miniAppFavorite('calculator'), appFavorite('assistants')]
      )
    ).toEqual([miniAppFavorite('calculator'), appFavorite('assistants')])
  })

  it('keeps a required app once when the requested reorder omits it', () => {
    const reordered = reorderSidebarFavorites([appFavorite('knowledge')], [appFavorite('knowledge')])

    expect(reordered).toEqual([appFavorite('knowledge'), appFavorite('assistants')])
    expect(reordered.filter((item) => item.type === 'app' && item.id === 'assistants')).toHaveLength(1)
  })
})

describe('launchpad app order (independent from sidebar favorites)', () => {
  it('falls back to the canonical order when the store is empty', () => {
    expect(getOrderedLaunchpadApps(undefined)).toEqual(SIDEBAR_FAVORITE_ORDER)
    expect(getOrderedLaunchpadApps([])).toEqual(SIDEBAR_FAVORITE_ORDER)
  })

  it('keeps the stored order first and appends missing apps in canonical order', () => {
    const ordered = getOrderedLaunchpadApps(['files', 'assistants'])
    expect(ordered.slice(0, 2)).toEqual(['files', 'assistants'])
    expect([...ordered].sort()).toEqual([...SIDEBAR_FAVORITE_ORDER].sort())
    expect(new Set(ordered).size).toBe(ordered.length)
  })

  it('drops unknown and duplicate stored ids', () => {
    const ordered = getOrderedLaunchpadApps(['files', 'ghost', 'files', 'assistants'])
    expect(ordered.slice(0, 2)).toEqual(['files', 'assistants'])
    expect(ordered).not.toContain('ghost')
    expect(new Set(ordered).size).toBe(ordered.length)
  })

  it('reorders to the requested order and keeps missing apps at the end', () => {
    const next = reorderLaunchpadApps(['assistants', 'agents', 'files'], ['files', 'assistants', 'agents'])
    expect(next.slice(0, 3)).toEqual(['files', 'assistants', 'agents'])
    expect([...next].sort()).toEqual([...SIDEBAR_FAVORITE_ORDER].sort())
  })

  it('drops unknown ids from a requested reorder', () => {
    const next = reorderLaunchpadApps(['assistants', 'agents'], ['ghost', 'agents', 'assistants'])
    expect(next.slice(0, 2)).toEqual(['agents', 'assistants'])
    expect(next).not.toContain('ghost')
  })
})
