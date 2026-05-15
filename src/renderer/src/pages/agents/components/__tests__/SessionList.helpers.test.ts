import type { ResourceListItemReorderPayload } from '@renderer/components/chat/resources'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import { describe, expect, it } from 'vitest'

import {
  buildSessionDropAnchor,
  canDropSessionItemInDisplayGroup,
  createSessionDisplayGroupResolver,
  createSessionWorkdirLabelMap,
  getPrimarySessionWorkdir,
  normalizeSessionDropPayload,
  normalizeSessionWorkdirPath,
  sortSessionsForDisplayGroups
} from '../SessionList.helpers'

const SESSION_GROUP_LABELS = {
  pinned: 'Pinned',
  time: {
    today: 'Today',
    yesterday: 'Yesterday',
    'this-week': 'This week',
    earlier: 'Earlier'
  },
  agent: {
    unknown: 'Unknown agent'
  },
  workdir: {
    none: 'No workspace'
  }
}

function localIso(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).toISOString()
}

function createSession(overrides: Partial<AgentSessionEntity & { pinned: boolean }> = {}) {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    name: 'Session one',
    description: '',
    accessiblePaths: ['/Users/jd/project-a'],
    orderKey: 'a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    pinned: false,
    ...overrides
  } satisfies AgentSessionEntity & { pinned: boolean }
}

describe('SessionList helpers', () => {
  it('builds normal ascending order anchors for session drops', () => {
    const payload: ResourceListItemReorderPayload = {
      type: 'item',
      activeId: 'a',
      overId: 'b',
      position: 'before',
      overType: 'item',
      sourceGroupId: 'session:agent:agent-1',
      targetGroupId: 'session:agent:agent-1',
      sourceIndex: 1,
      targetIndex: 0
    }

    expect(buildSessionDropAnchor(payload)).toEqual({ before: 'b' })
    expect(buildSessionDropAnchor({ ...payload, position: 'after' })).toEqual({ after: 'b' })
    expect(buildSessionDropAnchor({ ...payload, overId: 'session:agent:agent-1', overType: 'group' })).toEqual({
      position: 'last'
    })
  })

  it('preserves same-group item drop positions from the insertion line', () => {
    const payload: ResourceListItemReorderPayload = {
      type: 'item',
      activeId: 'a',
      overId: 'b',
      position: 'before',
      overType: 'item',
      sourceGroupId: 'session:agent:agent-1',
      targetGroupId: 'session:agent:agent-1',
      sourceIndex: 0,
      targetIndex: 1
    }

    expect(normalizeSessionDropPayload(payload)).toBe(payload)

    const crossGroupPayload = {
      ...payload,
      sourceGroupId: 'session:agent:agent-1',
      targetGroupId: 'session:agent:agent-2'
    }
    expect(normalizeSessionDropPayload(crossGroupPayload)).toBe(crossGroupPayload)
  })

  it('allows drag only inside the same non-pinned display group', () => {
    expect(
      canDropSessionItemInDisplayGroup({
        mode: 'agent',
        sourceGroupId: 'session:agent:agent-1',
        targetGroupId: 'session:agent:agent-1'
      })
    ).toBe(true)
    expect(
      canDropSessionItemInDisplayGroup({
        mode: 'agent',
        sourceGroupId: 'session:agent:agent-1',
        targetGroupId: 'session:agent:agent-2'
      })
    ).toBe(false)
    expect(
      canDropSessionItemInDisplayGroup({
        mode: 'workdir',
        sourceGroupId: 'session:pinned',
        targetGroupId: 'session:pinned'
      })
    ).toBe(false)
    expect(
      canDropSessionItemInDisplayGroup({
        mode: 'time',
        sourceGroupId: 'session:agent:agent-1',
        targetGroupId: 'session:agent:agent-1'
      })
    ).toBe(false)
  })

  it('groups sessions by time with pinned sessions taking precedence', () => {
    const now = new Date(2026, 4, 15, 12)
    const groupSession = createSessionDisplayGroupResolver({
      labels: SESSION_GROUP_LABELS,
      mode: 'time',
      now
    })

    expect(groupSession(createSession({ id: 'pinned', pinned: true }))).toEqual({
      id: 'session:pinned',
      label: 'Pinned'
    })
    expect(groupSession(createSession({ id: 'today', updatedAt: localIso(2026, 5, 15, 9) }))).toEqual({
      id: 'session:time:today',
      label: 'Today'
    })
    expect(groupSession(createSession({ id: 'earlier', updatedAt: localIso(2026, 5, 8, 9) }))).toEqual({
      id: 'session:time:earlier',
      label: 'Earlier'
    })
  })

  it('groups sessions by agent and workdir', () => {
    const agentById = new Map([['agent-1', { id: 'agent-1', name: 'Alpha agent' }]])
    const agentGroup = createSessionDisplayGroupResolver({
      agentById,
      labels: SESSION_GROUP_LABELS,
      mode: 'agent'
    })

    expect(agentGroup(createSession({ agentId: 'agent-1' }))).toEqual({
      id: 'session:agent:agent-1',
      label: 'Alpha agent'
    })
    expect(agentGroup(createSession({ agentId: 'missing-agent' }))).toEqual({
      id: 'session:agent:unknown',
      label: 'Unknown agent'
    })

    const workdirGroup = createSessionDisplayGroupResolver({
      labels: SESSION_GROUP_LABELS,
      mode: 'workdir',
      workdirLabelByPath: new Map([['/Users/jd/project-a', 'project-a']])
    })
    expect(workdirGroup(createSession({ accessiblePaths: ['/Users/jd/project-a/'] }))).toEqual({
      id: 'session:workdir:%2FUsers%2Fjd%2Fproject-a',
      label: 'project-a'
    })
    expect(workdirGroup(createSession({ accessiblePaths: [] }))).toEqual({
      id: 'session:workdir:none',
      label: 'No workspace'
    })
  })

  it('normalizes and labels workdir paths without merging duplicate basenames', () => {
    const sessions = [
      createSession({ accessiblePaths: ['/Users/jd/alpha/app'] }),
      createSession({ accessiblePaths: ['/Users/jd/beta/app/'] }),
      createSession({ accessiblePaths: ['/Users/jd/unique'] })
    ]

    expect(normalizeSessionWorkdirPath('/Users/jd/app/')).toBe('/Users/jd/app')
    expect(getPrimarySessionWorkdir(createSession({ accessiblePaths: ['  /Users/jd/app/  '] }))).toBe('/Users/jd/app')
    expect(createSessionWorkdirLabelMap(sessions)).toEqual(
      new Map([
        ['/Users/jd/alpha/app', 'alpha/app'],
        ['/Users/jd/beta/app', 'beta/app'],
        ['/Users/jd/unique', 'unique']
      ])
    )
  })

  it('sorts display groups by mode-specific ranks', () => {
    const sessions = [
      createSession({ id: 'older', orderKey: 'b', updatedAt: localIso(2026, 5, 14, 9) }),
      createSession({ id: 'pinned', pinned: true, orderKey: 'z', updatedAt: localIso(2026, 5, 10, 9) }),
      createSession({ id: 'newer', orderKey: 'a', updatedAt: localIso(2026, 5, 15, 9) })
    ]

    expect(
      sortSessionsForDisplayGroups(sessions, {
        mode: 'time',
        now: new Date(2026, 4, 15, 12)
      }).map((session) => session.id)
    ).toEqual(['pinned', 'newer', 'older'])

    expect(
      sortSessionsForDisplayGroups(sessions, {
        agentRankById: new Map([['agent-1', 0]]),
        mode: 'agent'
      }).map((session) => session.id)
    ).toEqual(['pinned', 'newer', 'older'])
  })

  it('sorts fractional order keys by raw lexicographic order', () => {
    const sessions = [
      createSession({ id: 'first-created', orderKey: 'a0' }),
      createSession({ id: 'inserted-before-first', orderKey: 'Zz' }),
      createSession({ id: 'inserted-before-that', orderKey: 'Zy' })
    ]

    expect(
      sortSessionsForDisplayGroups(sessions, {
        agentRankById: new Map([['agent-1', 0]]),
        mode: 'agent'
      }).map((session) => session.id)
    ).toEqual(['inserted-before-that', 'inserted-before-first', 'first-created'])
  })
})
