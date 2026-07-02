import { SIDEBAR_ICON_COMPONENTS } from '@renderer/components/app/sidebarIcons'
import type { SidebarFavorite, SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import { Library } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import {
  getOrderedVisibleSidebarFavorites,
  getSidebarFavoriteItems,
  getSidebarMenuPath,
  getSidebarMiniAppFavoriteIds,
  removeSidebarMiniApp,
  reorderSidebarApps,
  reorderSidebarMiniApps,
  resolveSidebarActiveItem,
  setSidebarAppPinned,
  SIDEBAR_FAVORITE_ORDER,
  toggleSidebarMiniApp
} from '../sidebar'

const appFavorite = (id: SidebarFavorite): SidebarFavoriteItem => ({ type: 'app', id })
const miniAppFavorite = (id: string): SidebarFavoriteItem => ({ type: 'mini_app', id })

describe('sidebar config helpers', () => {
  it('keeps the fixed sidebar app order available', () => {
    expect(SIDEBAR_FAVORITE_ORDER.slice(0, 6)).toEqual([
      'assistants',
      'agents',
      'paintings',
      'translate',
      'store',
      'mini_app'
    ])
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

  it('resolves menu paths and active items with the paintings provider route', () => {
    expect(getSidebarMenuPath('paintings', 'zhipu')).toBe('/app/paintings/zhipu')
    expect(resolveSidebarActiveItem('/app/paintings/zhipu')).toBe('paintings')
  })

  it('uses the library icon for the resource library sidebar item', () => {
    expect(SIDEBAR_ICON_COMPONENTS.store).toBe(Library)
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
  it('pins an app to the end while preserving mini apps', () => {
    expect(setSidebarAppPinned([appFavorite('assistants'), miniAppFavorite('calculator')], 'knowledge', true)).toEqual([
      appFavorite('assistants'),
      appFavorite('knowledge'),
      miniAppFavorite('calculator')
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

  it('reorders the app zone and keeps mini apps after it', () => {
    expect(
      reorderSidebarApps(
        [appFavorite('assistants'), appFavorite('knowledge'), appFavorite('files'), miniAppFavorite('calculator')],
        ['files', 'assistants', 'knowledge']
      )
    ).toEqual([
      appFavorite('files'),
      appFavorite('assistants'),
      appFavorite('knowledge'),
      miniAppFavorite('calculator')
    ])
  })

  it('keeps visible apps missing from a partial reorder at the end', () => {
    expect(
      reorderSidebarApps([appFavorite('assistants'), appFavorite('knowledge'), appFavorite('files')], ['files'])
    ).toEqual([appFavorite('files'), appFavorite('assistants'), appFavorite('knowledge')])
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

  it('reorders the mini app zone and keeps apps before it', () => {
    expect(
      reorderSidebarMiniApps(
        [appFavorite('assistants'), miniAppFavorite('calculator'), miniAppFavorite('weather')],
        ['weather', 'calculator']
      )
    ).toEqual([appFavorite('assistants'), miniAppFavorite('weather'), miniAppFavorite('calculator')])
  })

  it('keeps mini apps missing from a partial reorder at the end', () => {
    expect(
      reorderSidebarMiniApps(
        [
          appFavorite('assistants'),
          miniAppFavorite('calculator'),
          miniAppFavorite('weather'),
          miniAppFavorite('stale')
        ],
        ['weather', 'calculator']
      )
    ).toEqual([
      appFavorite('assistants'),
      miniAppFavorite('weather'),
      miniAppFavorite('calculator'),
      miniAppFavorite('stale')
    ])
  })
})
