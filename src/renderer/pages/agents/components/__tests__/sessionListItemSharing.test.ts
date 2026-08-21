import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { describe, expect, it } from 'vitest'

import { reconcileSessionListItems } from '../sessionListItemSharing'

function createSession(id: string, overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity {
  return {
    id,
    agentId: 'agent-a',
    modelId: null,
    name: `Session ${id}`,
    isNameManuallyEdited: false,
    description: '',
    workspaceId: 'workspace-a',
    workspace: {
      id: 'workspace-a',
      name: 'Workspace A',
      path: '/tmp/workspace-a',
      type: 'user',
      orderKey: 'a',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    orderKey: id,
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('reconcileSessionListItems', () => {
  it('reuses the container and every item for an equivalent DataApi refresh', () => {
    const initial = reconcileSessionListItems([createSession('a'), createSession('b')], new Map())
    const refreshed = reconcileSessionListItems([createSession('a'), createSession('b')], new Map(), initial)

    expect(refreshed).toBe(initial)
    expect(refreshed.items).toBe(initial.items)
  })

  it.each([
    {
      name: 'pin state',
      sessions: [createSession('a'), createSession('b')],
      pins: new Map([['a', 'pin-a']])
    },
    {
      name: 'entity data',
      sessions: [createSession('a', { name: 'Renamed A' }), createSession('b')],
      pins: new Map<string, string>()
    }
  ])('replaces only the affected item when $name changes', ({ pins, sessions }) => {
    const initial = reconcileSessionListItems([createSession('a'), createSession('b')], new Map())
    const updated = reconcileSessionListItems(sessions, pins, initial)

    expect(updated.items[0]).not.toBe(initial.items[0])
    expect(updated.items[1]).toBe(initial.items[1])
  })
})
