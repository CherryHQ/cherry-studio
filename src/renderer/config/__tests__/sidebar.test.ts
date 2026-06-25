import { Library } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import {
  getDefaultSidebarFavorites,
  getOrderedVisibleSidebarIcons,
  getRequiredSidebarIconsVisible,
  getSidebarMenuPath,
  resolveSidebarActiveItem,
  SIDEBAR_ICON_COMPONENTS,
  SIDEBAR_ICON_ORDER
} from '../sidebar'

describe('sidebar config helpers', () => {
  it('keeps the fixed sidebar app order available', () => {
    expect(SIDEBAR_ICON_ORDER.slice(0, 6)).toEqual([
      'assistants',
      'agents',
      'paintings',
      'translate',
      'store',
      'mini_app'
    ])
  })

  it('adds required sidebar icons back in fixed order when reading visible preferences', () => {
    expect(getRequiredSidebarIconsVisible(['translate'])).toEqual(['assistants', 'translate'])
  })

  it('preserves the preference order when reading ordered visible sidebar icons', () => {
    expect(getOrderedVisibleSidebarIcons(['translate', 'assistants', 'agents'])).toEqual([
      'translate',
      'assistants',
      'agents'
    ])
  })

  it('sanitizes ordered visible sidebar icons and keeps required icons visible', () => {
    expect(getOrderedVisibleSidebarIcons(['translate', 'unknown' as never, 'translate', 'agents'])).toEqual([
      'assistants',
      'translate',
      'agents'
    ])
  })

  it('ignores pinned mini app ids when reading system sidebar icons', () => {
    expect(getOrderedVisibleSidebarIcons(['translate', 'calculator', 'assistants', 'agents'])).toEqual([
      'translate',
      'assistants',
      'agents'
    ])
  })

  it('resets to default sidebar favorites without forcing non-default icons visible', () => {
    const reset = getDefaultSidebarFavorites()

    expect(reset).toEqual(['assistants', 'agents', 'store', 'translate', 'mini_app'])
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
