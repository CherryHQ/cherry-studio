import { SIDEBAR_ICON_COMPONENTS } from '@renderer/components/app/sidebarIcons'
import { Library } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import {
  getOrderedVisibleSidebarFavorites,
  getRequiredSidebarFavoritesVisible,
  getSidebarMenuPath,
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

  it('adds required sidebar favorites back in fixed order when reading visible preferences', () => {
    expect(getRequiredSidebarFavoritesVisible(['translate'])).toEqual(['assistants', 'translate'])
  })

  it('preserves the preference order when reading ordered visible sidebar favorites', () => {
    expect(getOrderedVisibleSidebarFavorites(['translate', 'assistants', 'agents'])).toEqual([
      'translate',
      'assistants',
      'agents'
    ])
  })

  it('sanitizes ordered visible sidebar favorites and keeps required favorites visible', () => {
    expect(getOrderedVisibleSidebarFavorites(['translate', 'unknown' as never, 'translate', 'agents'])).toEqual([
      'assistants',
      'translate',
      'agents'
    ])
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
})
