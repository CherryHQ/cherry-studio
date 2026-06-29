import { SIDEBAR_ICON_COMPONENTS } from '@renderer/components/app/sidebarIcons'
import { PRESETS_MINI_APPS } from '@shared/data/presets/miniApps'
import { Library } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import {
  getOrderedVisibleSidebarFavorites,
  getSidebarFavoriteIds,
  getSidebarMenuPath,
  getSidebarMiniAppFavoriteIds,
  resolveSidebarActiveItem,
  SIDEBAR_FAVORITE_ORDER
} from '../sidebar'

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
    expect(getOrderedVisibleSidebarFavorites(['translate', 'assistants', 'agents'])).toEqual([
      'translate',
      'assistants',
      'agents'
    ])
  })

  it('sanitizes ordered visible sidebar favorites and keeps required favorites visible', () => {
    expect(getOrderedVisibleSidebarFavorites(['translate', 'unknown', 'translate', 'agents'])).toEqual([
      'assistants',
      'translate',
      'agents'
    ])
  })

  it('ignores mini app favorites when reading system sidebar favorites', () => {
    expect(getOrderedVisibleSidebarFavorites(['translate', 'calculator', 'assistants', 'agents'])).toEqual([
      'translate',
      'assistants',
      'agents'
    ])
  })

  it('reads mini app favorite ids from sidebar favorite ids', () => {
    expect(getSidebarMiniAppFavoriteIds(['translate', 'calculator', 'assistants', 'calculator', 'weather'])).toEqual([
      'calculator',
      'weather'
    ])
  })

  it('dedupes favorite ids and preserves mini app ids', () => {
    expect(getSidebarFavoriteIds(['translate', 'calculator', 'assistants', 'calculator', 'weather'])).toEqual([
      'translate',
      'calculator',
      'assistants',
      'weather'
    ])
  })

  it('keeps preset mini app ids out of the system sidebar id namespace', () => {
    const sidebarFavoriteSet = new Set<string>(SIDEBAR_FAVORITE_ORDER)
    const conflictingPresetIds = PRESETS_MINI_APPS.flatMap((app) => (sidebarFavoriteSet.has(app.id) ? [app.id] : []))

    expect(conflictingPresetIds).toEqual([])
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
