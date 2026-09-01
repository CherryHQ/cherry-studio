import { createSidebarShortcutId, type SidebarShortcutItem } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it, vi } from 'vitest'

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
  it('serializes concurrent semantic mutations against the latest preference value', async () => {
    const harness = createClient()
    const service = new SidebarShortcutService(harness.client)
    const agent = createSidebarShortcutTarget('core.agent', 'agent-1')
    const assistant = createSidebarShortcutTarget('core.assistant', 'assistant-1')

    await Promise.all([service.setPinned(agent, true, 'Agent'), service.setPinned(assistant, true, 'Assistant')])

    expect(harness.current().map((item) => item.id)).toEqual([
      createSidebarShortcutId(createSidebarShortcutTarget('core.app', 'assistants')),
      createSidebarShortcutId(agent),
      createSidebarShortcutId(assistant)
    ])
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
