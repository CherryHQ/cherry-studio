import { SIDEBAR_ICON_COMPONENTS } from '@renderer/components/app/sidebarIcons'
import type { SidebarFavorite, SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import { Library } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import {
  getOrderedVisibleSidebarFavorites,
  getSidebarFavoriteItems,
  getSidebarMenuPath,
  getSidebarMiniAppFavoriteIds,
  resolveSidebarActiveItem,
  SIDEBAR_FAVORITE_ORDER
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
