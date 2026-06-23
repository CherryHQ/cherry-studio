import type {
  ResourceListGroupReorderPayload,
  ResourceListItemReorderPayload
} from '@renderer/components/chat/resources'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { describe, expect, it } from 'vitest'

import {
  buildSessionDropAnchor,
  buildSessionWorkdirGroupDropAnchor,
  canDropSessionItemInDisplayGroup,
  createSessionDisplayGroupResolver,
  createSessionWorkdirDisplayMaps,
  createSessionWorkdirLabelMap,
  getPrimarySessionWorkdir,
  moveSessionWorkdirGroupAfterDrop,
  normalizeSessionDropPayload,
  normalizeSessionWorkdirPath,
  SESSION_NO_PROJECT_GROUP_ID,
  sortSessionsForDisplayGroups
} from '../sessionListHelpers'

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
    none: 'No work directory'
  }
}

function localIso(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).toISOString()
}

function makeWorkspace(path: string, overrides: Partial<AgentWorkspaceEntity> = {}): AgentWorkspaceEntity {
  return {
    id: `ws-${path}`,
    name: path,
    path,
    type: 'user',
    orderKey: 'a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function createSession(overrides: Partial<AgentSessionEntity & { pinned: boolean }> = {}) {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    name: 'Session one',
    description: '',
    workspaceId: 'ws-/Users/jd/project-a',
    workspace: makeWorkspace('/Users/jd/project-a'),
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
      sourceGroupId: 'session:workdir:%2FUsers%2Fjd%2Fproject-a',
      targetGroupId: 'session:workdir:%2FUsers%2Fjd%2Fproject-a',
      sourceIndex: 1,
      targetIndex: 0
    }

    expect(buildSessionDropAnchor(payload)).toEqual({ before: 'b' })
    expect(buildSessionDropAnchor({ ...payload, position: 'after' })).toEqual({ after: 'b' })
    expect(
      buildSessionDropAnchor({ ...payload, overId: 'session:workdir:%2FUsers%2Fjd%2Fproject-a', overType: 'group' })
    ).toEqual({ position: 'last' })
  })

  it('builds workspace group order anchors from group drop direction', () => {
    const payload: ResourceListGroupReorderPayload = {
      type: 'group',
      activeGroupId: 'session:workspace:ws-a',
      overGroupId: 'session:workspace:ws-b',
      overType: 'group',
      sourceIndex: 0,
      targetIndex: 1
    }

    expect(buildSessionWorkdirGroupDropAnchor(payload, 'ws-b')).toEqual({ after: 'ws-b' })
    expect(buildSessionWorkdirGroupDropAnchor({ ...payload, sourceIndex: 2, targetIndex: 1 }, 'ws-b')).toEqual({
      before: 'ws-b'
    })
  })

  it('preserves same-group item drop positions from the insertion line', () => {
    const payload: ResourceListItemReorderPayload = {
      type: 'item',
      activeId: 'a',
      overId: 'b',
      position: 'before',
      overType: 'item',
      sourceGroupId: 'session:workdir:%2FUsers%2Fjd%2Fproject-a',
      targetGroupId: 'session:workdir:%2FUsers%2Fjd%2Fproject-a',
      sourceIndex: 0,
      targetIndex: 1
    }

    expect(normalizeSessionDropPayload(payload)).toBe(payload)

    const crossGroupPayload = {
      ...payload,
      sourceGroupId: 'session:workdir:%2FUsers%2Fjd%2Fproject-a',
      targetGroupId: 'session:workdir:%2FUsers%2Fjd%2Fproject-b'
    }
    expect(normalizeSessionDropPayload(crossGroupPayload)).toBe(crossGroupPayload)
  })

  it('allows drag only inside the same non-pinned display group', () => {
    expect(
      canDropSessionItemInDisplayGroup({
        mode: 'agent',
        sourceGroupId: 'session:agent:agent-a',
        targetGroupId: 'session:agent:agent-a'
      })
    ).toBe(true)
    expect(
      canDropSessionItemInDisplayGroup({
        mode: 'agent',
        sourceGroupId: 'session:agent:agent-a',
        targetGroupId: 'session:agent:agent-b'
      })
    ).toBe(false)
    expect(
      canDropSessionItemInDisplayGroup({
        mode: 'workdir',
        sourceGroupId: 'session:workspace:ws-a',
        targetGroupId: 'session:workspace:ws-a'
      })
    ).toBe(true)
    expect(
      canDropSessionItemInDisplayGroup({
        mode: 'workdir',
        sourceGroupId: 'session:workspace:ws-a',
        targetGroupId: 'session:workspace:ws-b'
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
        sourceGroupId: 'session:workspace:ws-a',
        targetGroupId: 'session:workspace:ws-a'
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
    const agentGroup = createSessionDisplayGroupResolver({
      agentById: new Map([['agent-1', { id: 'agent-1', name: 'Alpha agent' }]]),
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

    const session = createSession({
      workspaceId: 'ws-project-a',
      workspace: makeWorkspace('/Users/jd/project-a/', { id: 'ws-project-a' })
    })
    const workdirGroup = createSessionDisplayGroupResolver({
      labels: SESSION_GROUP_LABELS,
      mode: 'workdir',
      workdirDisplay: createSessionWorkdirDisplayMaps(
        [session],
        [makeWorkspace('/Users/jd/project-a', { id: 'ws-project-a', name: 'Project A Workspace' })]
      )
    })
    expect(workdirGroup(session)).toEqual({
      id: 'session:workspace:ws-project-a',
      label: 'Project A Workspace'
    })
    expect(
      workdirGroup(
        createSession({
          workspaceId: 'system-ws',
          workspace: makeWorkspace('/Users/jd/Data/Agents/system/session', { id: 'system-ws', type: 'system' })
        })
      )
    ).toEqual({
      id: SESSION_NO_PROJECT_GROUP_ID,
      label: ''
    })
  })

  it('treats system workspaces as the dedicated no-project display group only in workdir mode', () => {
    const systemWorkspace = makeWorkspace('/Users/jd/Data/Agents/system/2026-05-25/120000-session', {
      id: 'system-ws',
      name: 'No work directory',
      type: 'system'
    })
    const session = createSession({
      id: 'system-session',
      workspaceId: systemWorkspace.id,
      workspace: systemWorkspace
    })
    const workdirDisplay = createSessionWorkdirDisplayMaps([session], [systemWorkspace])

    expect(getPrimarySessionWorkdir(session)).toBeNull()
    expect(createSessionWorkdirLabelMap([session], [systemWorkspace])).toEqual(new Map())
    const workdirGroup = createSessionDisplayGroupResolver({
      labels: SESSION_GROUP_LABELS,
      mode: 'workdir',
      workdirDisplay
    })
    expect(workdirGroup(session)).toEqual({
      id: SESSION_NO_PROJECT_GROUP_ID,
      label: ''
    })

    const agentGroup = createSessionDisplayGroupResolver({
      agentById: new Map([['agent-1', { id: 'agent-1', name: 'Alpha agent' }]]),
      labels: SESSION_GROUP_LABELS,
      mode: 'agent'
    })
    expect(agentGroup(session)).toEqual({
      id: 'session:agent:agent-1',
      label: 'Alpha agent'
    })
  })

  it('normalizes and labels workdir paths without merging duplicate basenames', () => {
    const sessions = [
      createSession({ workspace: makeWorkspace('/Users/jd/alpha/app') }),
      createSession({ workspace: makeWorkspace('/Users/jd/beta/app/') }),
      createSession({ workspace: makeWorkspace('/Users/jd/unique') })
    ]

    expect(normalizeSessionWorkdirPath('/Users/jd/app/')).toBe('/Users/jd/app')
    expect(getPrimarySessionWorkdir(createSession({ workspace: makeWorkspace('  /Users/jd/app/  ') }))).toBe(
      '/Users/jd/app'
    )
    expect(createSessionWorkdirLabelMap(sessions)).toEqual(
      new Map([
        ['session:workdir:%2FUsers%2Fjd%2Falpha%2Fapp', 'alpha/app'],
        ['session:workdir:%2FUsers%2Fjd%2Fbeta%2Fapp', 'beta/app'],
        ['session:workdir:%2FUsers%2Fjd%2Funique', 'unique']
      ])
    )
  })

  it('uses workspace rows for workdir labels and ranks independent of session order', () => {
    const sessions = [
      createSession({
        id: 'session-a',
        workspaceId: 'ws-a',
        workspace: makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'Embedded A', orderKey: 'z' })
      }),
      createSession({
        id: 'session-b',
        workspaceId: 'ws-b',
        workspace: makeWorkspace('/Users/jd/project-b', { id: 'ws-b', name: 'Embedded B', orderKey: 'z' })
      })
    ]
    const workspaces = [
      makeWorkspace('/Users/jd/project-empty', { id: 'ws-empty', name: 'Empty Workspace', orderKey: '0' }),
      makeWorkspace('/Users/jd/project-b', { id: 'ws-b', name: 'DB Beta', orderKey: 'a' }),
      makeWorkspace('/Users/jd/project-a', { id: 'ws-a', name: 'DB Alpha', orderKey: 'b' })
    ]

    expect(createSessionWorkdirLabelMap(sessions, workspaces)).toEqual(
      new Map([
        ['session:workspace:ws-b', 'DB Beta'],
        ['session:workspace:ws-a', 'DB Alpha']
      ])
    )
    expect(
      sortSessionsForDisplayGroups(sessions, {
        mode: 'workdir',
        workdirDisplay: createSessionWorkdirDisplayMaps(sessions, workspaces)
      }).map((session) => session.id)
    ).toEqual(['session-b', 'session-a'])
  })

  it('keeps session-derived fallback workdirs after known workspace rows', () => {
    const sessions = [
      createSession({
        id: 'unknown',
        workspaceId: 'ws-unknown',
        workspace: makeWorkspace('/Users/jd/unknown', { id: 'ws-unknown', name: 'Embedded Unknown' }),
        orderKey: 'a'
      }),
      createSession({
        id: 'known',
        workspaceId: 'ws-known',
        workspace: makeWorkspace('/Users/jd/known', { id: 'ws-known', name: 'Embedded Known' }),
        orderKey: 'z'
      })
    ]
    const workspaces = [makeWorkspace('/Users/jd/known', { id: 'ws-known', name: 'Known Workspace' })]

    expect(createSessionWorkdirLabelMap(sessions, workspaces)).toEqual(
      new Map([
        ['session:workspace:ws-known', 'Known Workspace'],
        ['session:workdir:%2FUsers%2Fjd%2Funknown', 'unknown']
      ])
    )
    expect(
      sortSessionsForDisplayGroups(sessions, {
        mode: 'workdir',
        workdirDisplay: createSessionWorkdirDisplayMaps(sessions, workspaces)
      }).map((session) => session.id)
    ).toEqual(['known', 'unknown'])
  })

  it('moves workspace rows optimistically after group drops', () => {
    const workspaces = [
      makeWorkspace('/Users/jd/project-a', { id: 'ws-a' }),
      makeWorkspace('/Users/jd/project-b', { id: 'ws-b' }),
      makeWorkspace('/Users/jd/project-c', { id: 'ws-c' })
    ]

    expect(
      moveSessionWorkdirGroupAfterDrop(workspaces, 'ws-a', 'ws-c', {
        sourceIndex: 0,
        targetIndex: 2
      }).map((workspace) => workspace.id)
    ).toEqual(['ws-b', 'ws-c', 'ws-a'])
    expect(
      moveSessionWorkdirGroupAfterDrop(workspaces, 'ws-c', 'ws-a', {
        sourceIndex: 2,
        targetIndex: 0
      }).map((workspace) => workspace.id)
    ).toEqual(['ws-c', 'ws-a', 'ws-b'])
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

    expect(
      sortSessionsForDisplayGroups(sessions, {
        mode: 'workdir',
        workdirDisplay: createSessionWorkdirDisplayMaps(sessions, [makeWorkspace('/Users/jd/project-a')])
      }).map((session) => session.id)
    ).toEqual(['pinned', 'newer', 'older'])
  })

  it('keeps system workspace sessions at the bottom only in workdir mode', () => {
    const systemWorkspace = makeWorkspace('/Users/jd/Data/Agents/system/2026-05-25/120000-session', {
      id: 'system-ws',
      type: 'system'
    })
    const sessions = [
      createSession({
        id: 'system',
        agentId: 'agent-a',
        orderKey: '0',
        workspaceId: 'system-ws',
        workspace: systemWorkspace
      }),
      createSession({
        id: 'project-b',
        agentId: 'agent-b',
        orderKey: 'b',
        workspaceId: 'ws-/Users/jd/project-b',
        workspace: makeWorkspace('/Users/jd/project-b')
      }),
      createSession({ id: 'project-a', agentId: 'agent-a', orderKey: 'a' })
    ]

    expect(
      sortSessionsForDisplayGroups(sessions, {
        agentRankById: new Map([
          ['agent-a', 0],
          ['agent-b', 1]
        ]),
        mode: 'agent'
      }).map((session) => session.id)
    ).toEqual(['system', 'project-a', 'project-b'])

    expect(
      sortSessionsForDisplayGroups(sessions, {
        mode: 'workdir',
        workdirDisplay: createSessionWorkdirDisplayMaps(sessions, [
          makeWorkspace('/Users/jd/project-a'),
          makeWorkspace('/Users/jd/project-b')
        ])
      }).map((session) => session.id)
    ).toEqual(['project-a', 'project-b', 'system'])
  })

  it('sorts fractional order keys by raw lexicographic order', () => {
    const sessions = [
      createSession({ id: 'first-created', orderKey: 'a0' }),
      createSession({ id: 'inserted-before-first', orderKey: 'Zz' }),
      createSession({ id: 'inserted-before-that', orderKey: 'Zy' })
    ]

    expect(
      sortSessionsForDisplayGroups(sessions, {
        mode: 'workdir',
        workdirDisplay: createSessionWorkdirDisplayMaps(sessions, [makeWorkspace('/Users/jd/project-a')])
      }).map((session) => session.id)
    ).toEqual(['inserted-before-that', 'inserted-before-first', 'first-created'])
  })
})
