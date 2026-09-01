import { createSidebarShortcutId, type SidebarShortcutItem } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import {
  addSidebarShortcut,
  createSidebarShortcutTarget,
  getVisibleSidebarShortcutItems,
  normalizeSidebarShortcutItems,
  removeSidebarShortcut,
  reorderSidebarShortcuts
} from '../sidebar'

const shortcut = (providerId: string, resourceId: string, activationId?: string): SidebarShortcutItem => {
  const target = createSidebarShortcutTarget(providerId, resourceId, activationId)
  return { type: 'shortcut', id: createSidebarShortcutId(target), target }
}

describe('sidebar shortcut storage transforms', () => {
  it('migrates legacy leaves, deduplicates them, and preserves future top-level items', () => {
    const future = { type: 'group', id: 'future', children: ['x'] }
    const result = normalizeSidebarShortcutItems([
      { type: 'agent', id: 'agent-1', fallbackLabel: 'Researcher' },
      { type: 'agent', id: 'agent-1' },
      future,
      { type: 'shortcut', id: 'stale-id', target: shortcut('core.prompt', 'prompt-1').target }
    ])

    expect(result).toEqual([
      shortcut('core.app', 'assistants'),
      { ...shortcut('core.agent', 'agent-1'), fallbackLabel: 'Researcher' },
      future,
      shortcut('core.prompt', 'prompt-1')
    ])
    expect(getVisibleSidebarShortcutItems(result)).not.toContain(future)
  })

  it('allows different activations for one resource but rejects an exact duplicate', () => {
    const reveal = createSidebarShortcutTarget('core.prompt', 'prompt-1')
    const insert = createSidebarShortcutTarget('core.prompt', 'prompt-1', 'insert')
    const result = addSidebarShortcut(addSidebarShortcut([], reveal), insert)

    expect(result.map((item) => item.id)).toEqual([
      shortcut('core.app', 'assistants').id,
      createSidebarShortcutId(reveal),
      createSidebarShortcutId(insert)
    ])
    expect(addSidebarShortcut(result, reveal)).toEqual(result)
  })

  it('drops shortcuts for resources that are no longer exposed in the sidebar', () => {
    const agent = shortcut('core.agent', 'agent-1')

    expect(
      normalizeSidebarShortcutItems([
        shortcut('core.skill', 'skill-1'),
        shortcut('core.mcp-server', 'server-1'),
        shortcut('core.provider', 'provider-1'),
        agent
      ])
    ).toEqual([shortcut('core.app', 'assistants'), agent])
  })

  it('keeps required shortcuts and reorders only visible shortcut slots', () => {
    const assistant = shortcut('core.app', 'assistants')
    const agent = shortcut('core.agent', 'agent-1')
    const topic = shortcut('core.topic', 'topic-1')
    const future = { type: 'group', id: 'future' } as unknown as SidebarShortcutItem
    const stored = [agent, future, assistant, topic]

    expect(removeSidebarShortcut(stored, assistant.target)).toEqual(stored)
    expect(reorderSidebarShortcuts(stored, [topic, assistant, agent])).toEqual([topic, future, assistant, agent])
  })
})
