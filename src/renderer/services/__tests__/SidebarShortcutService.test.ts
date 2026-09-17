import { createMockPreferenceService } from '@test-mocks/renderer/PreferenceService'
import { describe, expect, it, vi } from 'vitest'

import { createSidebarShortcutId, type SidebarShortcutItem } from '@shared/data/preference/preferenceTypes'

import { createSidebarShortcutTarget } from '../../utils/sidebar'
import { SidebarShortcutService } from '../SidebarShortcutService'

function createClient(initial: SidebarShortcutItem[] = []) {
  let current = initial
  const set = vi.fn(async (_key: string, value: SidebarShortcutItem[]) => {
    current = value
  })
  return {
    client: { get: vi.fn(async () => current), set } as never,
    current: () => current,
    set
  }
}

describe('SidebarShortcutService', () => {
  it('writes shortcuts without reading or changing legacy favorites', async () => {
    const legacy = [{ type: 'app', id: 'translate' }]
    const preferences = createMockPreferenceService({
      'ui.sidebar.favorites': legacy,
      'ui.sidebar_shortcut': []
    })
    const service = new SidebarShortcutService(preferences)
    const target = createSidebarShortcutTarget('core.agent', 'agent-1')

    await service.setPinned(target, true)

    expect(preferences.getCachedValue('ui.sidebar_shortcut')).toEqual([
      { type: 'shortcut', id: createSidebarShortcutId(target), target }
    ])
    expect(preferences.getCachedValue('ui.sidebar.favorites')).toEqual(legacy)
  })

  it('keeps repeated stale add intents pinned and repeated remove intents unpinned', async () => {
    const harness = createClient()
    const service = new SidebarShortcutService(harness.client)
    const target = createSidebarShortcutTarget('core.agent', 'agent-1')
    await Promise.all([service.setPinned(target, true, 'Agent'), service.setPinned(target, true, 'Agent')])
    expect(harness.current()).toEqual([
      { type: 'shortcut', id: createSidebarShortcutId(target), target, fallbackLabel: 'Agent' }
    ])
    await Promise.all([service.setPinned(target, false), service.setPinned(target, false)])
    expect(harness.current()).toEqual([])
  })
  it('serializes concurrent semantic mutations against the latest preference value', async () => {
    const harness = createClient()
    const service = new SidebarShortcutService(harness.client)
    const agent = createSidebarShortcutTarget('core.agent', 'agent-1')
    const assistant = createSidebarShortcutTarget('core.assistant', 'assistant-1')

    await Promise.all([service.setPinned(agent, true, 'Agent'), service.setPinned(assistant, true, 'Assistant')])

    expect(harness.current().map((item) => item.id)).toEqual([
      createSidebarShortcutId(agent),
      createSidebarShortcutId(assistant)
    ])
  })

  it('refuses to remove the final built-in app shortcut', async () => {
    const app = createSidebarShortcutTarget('core.app', 'assistants')
    const initial = [
      { type: 'shortcut', id: createSidebarShortcutId(app), target: app }
    ] satisfies SidebarShortcutItem[]
    const harness = createClient(initial)
    const service = new SidebarShortcutService(harness.client)

    await service.remove(app)

    expect(harness.current()).toEqual(initial)
    expect(harness.set).not.toHaveBeenCalled()
  })

  it('rejects a failed mutation without blocking the next queued mutation', async () => {
    const harness = createClient()
    harness.set.mockRejectedValueOnce(new Error('write failed'))
    const service = new SidebarShortcutService(harness.client)
    const failed = service.setPinned(createSidebarShortcutTarget('core.agent', 'agent-1'), true)
    const nextTarget = createSidebarShortcutTarget('core.assistant', 'assistant-1')
    const next = service.setPinned(nextTarget, true)

    await expect(failed).rejects.toThrow('write failed')
    await expect(next).resolves.toBeUndefined()
    expect(harness.current().some((item) => item.id === createSidebarShortcutId(nextTarget))).toBe(true)
  })
})
