import { Library } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import {
  buildSidebarIconManagerItems,
  getDefaultSidebarIconPreferences,
  getOrderedVisibleSidebarIcons,
  getRequiredSidebarIconsVisible,
  getSidebarIconPreferencesFromVisibleIcons,
  getSidebarMenuPath,
  resolveSidebarActiveItem,
  SIDEBAR_ICON_COMPONENTS
} from '../sidebar'

describe('sidebar config helpers', () => {
  it('builds manager items in the fixed sidebar order', () => {
    expect(buildSidebarIconManagerItems().slice(0, 6)).toEqual([
      'assistants',
      'agents',
      'paintings',
      'translate',
      'store',
      'mini_app'
    ])
  })

  it('splits visible icons back into visible and hidden preferences in fixed order', () => {
    expect(
      getSidebarIconPreferencesFromVisibleIcons({
        visibleIcons: new Set(['assistants', 'files'])
      })
    ).toEqual({
      visible: ['assistants', 'files'],
      invisible: [
        'agents',
        'paintings',
        'translate',
        'store',
        'mini_app',
        'knowledge',
        'code_tools',
        'notes',
        'openclaw'
      ]
    })
  })

  it('keeps the required assistant icon visible when saving preferences', () => {
    expect(
      getSidebarIconPreferencesFromVisibleIcons({
        visibleIcons: new Set(['translate'])
      })
    ).toEqual({
      visible: ['assistants', 'translate'],
      invisible: ['agents', 'paintings', 'store', 'mini_app', 'knowledge', 'files', 'code_tools', 'notes', 'openclaw']
    })
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

  it('resets to default visible sidebar icons without forcing non-default icons visible', () => {
    const reset = getDefaultSidebarIconPreferences()

    expect(reset.visible).toEqual(['assistants', 'agents', 'paintings', 'translate', 'store'])
    expect(reset.invisible).toEqual([])
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
