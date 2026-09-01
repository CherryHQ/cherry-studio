import type { SidebarFavorite, SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import {
  getOrderedLaunchpadApps,
  getOrderedVisibleSidebarFavoriteItems,
  getOrderedVisibleSidebarFavorites,
  getSidebarDefaultLandingUrl,
  getSidebarFavoriteItems,
  getSidebarMiniAppFavoriteIds,
  isMessageOnlyConversationUrl,
  removeSidebarEntityFavorite,
  removeSidebarMiniApp,
  reorderLaunchpadApps,
  reorderSidebarFavorites,
  resolveSidebarActiveItem,
  setSidebarAppPinned,
  SIDEBAR_FAVORITE_ORDER,
  toggleSidebarEntityFavorite,
  toggleSidebarMiniApp
} from '../sidebar'

const appFavorite = (id: SidebarFavorite): SidebarFavoriteItem => ({ type: 'app', id })
const miniAppFavorite = (id: string): SidebarFavoriteItem => ({ type: 'mini_app', id })
const agentFavorite = (id: string): SidebarFavoriteItem => ({ type: 'agent', id })
const assistantFavorite = (id: string): SidebarFavoriteItem => ({ type: 'assistant', id })

describe('sidebar config helpers', () => {
  it('keeps the fixed sidebar app order available', () => {
    expect(SIDEBAR_FAVORITE_ORDER).toEqual(['assistants', 'agents', 'translate', 'knowledge'])
  })

  it('preserves the preference order when reading ordered visible sidebar favorites', () => {
    expect(
      getOrderedVisibleSidebarFavorites([appFavorite('translate'), appFavorite('assistants'), appFavorite('agents')])
    ).toEqual(['translate', 'assistants', 'agents'])
  })

  it('sanitizes ordered visible sidebar favorites preserving stored order', () => {
    expect(
      getOrderedVisibleSidebarFavorites([
        appFavorite('translate'),
        { type: 'app', id: 'unknown' } as never,
        appFavorite('translate'),
        appFavorite('agents')
      ])
    ).toEqual(['translate', 'agents'])
  })

  it('drops mini app favorites from the core sidebar', () => {
    expect(
      getOrderedVisibleSidebarFavorites([
        appFavorite('translate'),
        miniAppFavorite('calculator'),
        appFavorite('assistants'),
        appFavorite('agents')
      ])
    ).toEqual(['translate', 'assistants', 'agents'])
  })

  it('preserves legacy mini app favorites in the stored mixed list', () => {
    expect(
      getOrderedVisibleSidebarFavoriteItems([
        appFavorite('translate'),
        miniAppFavorite('calculator'),
        appFavorite('agents')
      ])
    ).toEqual([appFavorite('translate'), miniAppFavorite('calculator'), appFavorite('agents')])
  })

  it('keeps legacy mini app entries in the stored mixed list', () => {
    expect(getOrderedVisibleSidebarFavoriteItems([miniAppFavorite('calculator'), appFavorite('assistants')])).toEqual([
      miniAppFavorite('calculator'),
      appFavorite('assistants')
    ])
  })

  it('keeps a stored Agent-first order when required Chat is already present', () => {
    expect(
      getOrderedVisibleSidebarFavoriteItems([
        appFavorite('agents'),
        appFavorite('assistants'),
        appFavorite('translate'),
        appFavorite('knowledge')
      ])
    ).toEqual([appFavorite('agents'), appFavorite('assistants'), appFavorite('translate'), appFavorite('knowledge')])
  })

  it('reads legacy mini app favorite ids for backward compatibility', () => {
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

  it('resolves the default landing url from the first visible app in stored order', () => {
    expect(getSidebarDefaultLandingUrl([appFavorite('translate'), appFavorite('agents')], 'zhipu')).toBe(
      '/app/translate'
    )
    expect(getSidebarDefaultLandingUrl([appFavorite('assistants'), appFavorite('agents')], 'zhipu')).toBe('/app/chat')
    expect(getSidebarDefaultLandingUrl([appFavorite('paintings')], 'zhipu')).toBe('')
  })

  it('returns an empty default landing url when no app is visible', () => {
    expect(getSidebarDefaultLandingUrl(undefined, 'zhipu')).toBe('')
    expect(getSidebarDefaultLandingUrl([], 'zhipu')).toBe('')
    expect(getSidebarDefaultLandingUrl([miniAppFavorite('calculator')], 'zhipu')).toBe('')
  })

  it('does not resolve removed app routes', () => {
    expect(resolveSidebarActiveItem('/app/paintings/zhipu')).toBe('')
  })

  it('resolves the active item for query-keyed conversation routes', () => {
    expect(resolveSidebarActiveItem('/app/chat?topicId=abc')).toBe('assistants')
    expect(resolveSidebarActiveItem('/app/agents?sessionId=xyz')).toBe('agents')
  })

  it('does not mark legacy mini app routes active', () => {
    expect(resolveSidebarActiveItem('/app/mini-app/qwen')).toBe('')
  })

  it('classifies a message-view URL as message-only only when it carries its conversation id', () => {
    expect(isMessageOnlyConversationUrl('/app/chat?topicId=topic&view=message')).toBe(true)
    expect(isMessageOnlyConversationUrl('/app/agents?sessionId=session&view=message')).toBe(true)
    // Malformed: `view=message` without an id is a bare entry, not a message-only popup.
    expect(isMessageOnlyConversationUrl('/app/chat?view=message')).toBe(false)
    expect(isMessageOnlyConversationUrl('/app/agents?view=message')).toBe(false)
    expect(isMessageOnlyConversationUrl('/app/chat?topicId=topic')).toBe(false)
  })
})

describe('sidebar favorites mutations', () => {
  it('pins an app while preserving legacy mini apps', () => {
    expect(setSidebarAppPinned([appFavorite('assistants'), miniAppFavorite('calculator')], 'knowledge', true)).toEqual([
      appFavorite('assistants'),
      miniAppFavorite('calculator'),
      appFavorite('knowledge')
    ])
  })

  it('unpins an app while preserving legacy mini apps', () => {
    expect(
      setSidebarAppPinned(
        [appFavorite('assistants'), appFavorite('knowledge'), miniAppFavorite('calculator')],
        'knowledge',
        false
      )
    ).toEqual([appFavorite('assistants'), miniAppFavorite('calculator')])
  })

  it('unpins the chat assistant like any other app', () => {
    expect(setSidebarAppPinned([appFavorite('assistants'), appFavorite('knowledge')], 'assistants', false)).toEqual([
      appFavorite('knowledge')
    ])
  })

  it('toggles a legacy mini app favorite', () => {
    const added = toggleSidebarMiniApp([appFavorite('assistants'), miniAppFavorite('calculator')], 'weather')
    expect(added).toEqual([appFavorite('assistants'), miniAppFavorite('calculator'), miniAppFavorite('weather')])
    expect(toggleSidebarMiniApp(added, 'calculator')).toEqual([appFavorite('assistants'), miniAppFavorite('weather')])
  })

  it('removes a mini app from legacy preferences while retaining other entries', () => {
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

  it('normalizes agent and assistant favorites into the visible list', () => {
    expect(
      getOrderedVisibleSidebarFavoriteItems([
        appFavorite('assistants'),
        agentFavorite('agent-1'),
        assistantFavorite('assistant-1')
      ])
    ).toEqual([appFavorite('assistants'), agentFavorite('agent-1'), assistantFavorite('assistant-1')])
  })

  it('drops agent/assistant favorites without an id during normalization', () => {
    expect(
      getSidebarFavoriteItems([
        appFavorite('assistants'),
        { type: 'agent' } as unknown as SidebarFavoriteItem,
        { type: 'assistant' } as unknown as SidebarFavoriteItem
      ])
    ).toEqual([appFavorite('assistants')])
  })

  it('toggles an entity favorite on and off, preserving apps and other entities', () => {
    const added = toggleSidebarEntityFavorite(
      [appFavorite('assistants'), assistantFavorite('assistant-1')],
      'agent',
      'agent-1'
    )
    expect(added).toEqual([appFavorite('assistants'), assistantFavorite('assistant-1'), agentFavorite('agent-1')])

    expect(toggleSidebarEntityFavorite(added, 'assistant', 'assistant-1')).toEqual([
      appFavorite('assistants'),
      agentFavorite('agent-1')
    ])
  })

  it('removes an entity favorite while preserving apps and the other entity type', () => {
    expect(
      removeSidebarEntityFavorite(
        [appFavorite('assistants'), agentFavorite('agent-1'), assistantFavorite('assistant-1')],
        'agent',
        'agent-1'
      )
    ).toEqual([appFavorite('assistants'), assistantFavorite('assistant-1')])
  })

  it('does not treat known agent/assistant favorites as forward-compatible unknown items on mutation', () => {
    const group = { type: 'group', id: 'g1', name: 'Group', items: [] } as unknown as SidebarFavoriteItem

    expect(toggleSidebarEntityFavorite([agentFavorite('agent-1'), group], 'agent', 'agent-1')).toEqual([group])
    expect(toggleSidebarEntityFavorite([assistantFavorite('assistant-1'), group], 'assistant', 'assistant-1')).toEqual([
      group
    ])
  })
})

describe('reorderSidebarFavorites (mixed cross-type reorder)', () => {
  it('preserves mini apps when reordering legacy favorites', () => {
    expect(
      reorderSidebarFavorites(
        [appFavorite('assistants'), appFavorite('knowledge'), miniAppFavorite('calculator')],
        [miniAppFavorite('calculator'), appFavorite('assistants'), appFavorite('knowledge')]
      )
    ).toEqual([miniAppFavorite('calculator'), appFavorite('assistants'), appFavorite('knowledge')])
  })

  it('keeps legacy favorites missing from a partial order', () => {
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

  it('drops an app omitted from the requested reorder', () => {
    expect(reorderSidebarFavorites([appFavorite('knowledge')], [appFavorite('knowledge')])).toEqual([
      appFavorite('knowledge')
    ])
  })
})

describe('launchpad app order (independent from sidebar favorites)', () => {
  it('falls back to the canonical order when the store is empty', () => {
    expect(getOrderedLaunchpadApps(undefined)).toEqual(SIDEBAR_FAVORITE_ORDER)
    expect(getOrderedLaunchpadApps([])).toEqual(SIDEBAR_FAVORITE_ORDER)
  })

  it('keeps the stored order first and appends missing apps in canonical order', () => {
    const ordered = getOrderedLaunchpadApps(['knowledge', 'assistants'])
    expect(ordered.slice(0, 2)).toEqual(['knowledge', 'assistants'])
    expect([...ordered].sort()).toEqual([...SIDEBAR_FAVORITE_ORDER].sort())
    expect(new Set(ordered).size).toBe(ordered.length)
  })

  it('drops unknown and duplicate stored ids', () => {
    const ordered = getOrderedLaunchpadApps(['knowledge', 'ghost', 'knowledge', 'assistants'])
    expect(ordered.slice(0, 2)).toEqual(['knowledge', 'assistants'])
    expect(ordered).not.toContain('ghost')
    expect(new Set(ordered).size).toBe(ordered.length)
  })

  it('reorders to the requested order and keeps missing apps at the end', () => {
    const next = reorderLaunchpadApps(['assistants', 'agents', 'knowledge'], ['knowledge', 'assistants', 'agents'])
    expect(next.slice(0, 3)).toEqual(['knowledge', 'assistants', 'agents'])
    expect([...next].sort()).toEqual([...SIDEBAR_FAVORITE_ORDER].sort())
  })

  it('drops unknown ids from a requested reorder', () => {
    const next = reorderLaunchpadApps(['assistants', 'agents'], ['ghost', 'agents', 'assistants'])
    expect(next.slice(0, 2)).toEqual(['agents', 'assistants'])
    expect(next).not.toContain('ghost')
  })
})
