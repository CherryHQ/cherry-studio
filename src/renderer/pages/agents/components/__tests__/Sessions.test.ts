import { describe, expect, it } from 'vitest'

import type { SessionListItem } from '@renderer/utils/chat/sessionListHelpers'

import { buildCreateSessionSeed, buildCreateSessionSeedIndex } from '../Sessions'

const workspace = (path: string) => ({
  id: `workspace-${path}`,
  name: path,
  path,
  type: 'user' as const,
  orderKey: path,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

const session = (overrides: Partial<SessionListItem> = {}) =>
  ({
    id: 'session-1',
    agentId: 'agent-1',
    workspaceId: 'workspace-1',
    workspace: workspace('/Users/jd/project-a'),
    pinned: false,
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }) as SessionListItem

describe('buildCreateSessionSeed', () => {
  it('copies the agent and workspace id from the source session', () => {
    expect(buildCreateSessionSeed(session({ agentId: 'agent-2', workspaceId: 'workspace-2' }))).toEqual({
      agentId: 'agent-2',
      workspace: { type: 'user', workspaceId: 'workspace-2' }
    })
  })

  it('falls back to the embedded workspace path when the workspace id is missing', () => {
    expect(
      buildCreateSessionSeed(session({ workspaceId: undefined, workspace: workspace('/Users/jd/project-b') }))
    ).toEqual({
      agentId: 'agent-1',
      workspacePath: '/Users/jd/project-b'
    })
  })

  it('returns null when the source session has no agent', () => {
    expect(buildCreateSessionSeed(session({ agentId: undefined }))).toBeNull()
  })

  it('preserves no-project mode instead of reusing a system workspace id', () => {
    expect(
      buildCreateSessionSeed(
        session({
          workspaceId: 'system-workspace',
          workspace: {
            ...workspace('/Users/jd/Data/Agents/system/2026-05-25/120000-session'),
            id: 'system-workspace',
            type: 'system'
          }
        })
      )
    ).toEqual({
      agentId: 'agent-1',
      workspace: { type: 'system' }
    })
  })
})

describe('buildCreateSessionSeedIndex', () => {
  it('indexes the latest unpinned session globally and per group', () => {
    const sessions = [
      session({
        id: 'pinned-session',
        agentId: 'agent-pinned',
        pinned: true,
        lastActivityAt: '2026-01-05T00:00:00.000Z'
      }),
      session({
        id: 'older-session',
        agentId: 'agent-older',
        workspaceId: 'workspace-older',
        lastActivityAt: '2026-01-02T00:00:00.000Z'
      }),
      session({
        id: 'newer-session',
        agentId: 'agent-newer',
        workspaceId: 'workspace-newer',
        lastActivityAt: '2026-01-03T00:00:00.000Z'
      }),
      session({
        id: 'other-session',
        agentId: 'agent-other',
        workspaceId: 'workspace-other',
        lastActivityAt: '2026-01-04T00:00:00.000Z'
      })
    ]
    const groupIdBySessionId = new Map([
      ['pinned-session', 'group-pinned'],
      ['older-session', 'group-a'],
      ['newer-session', 'group-a'],
      ['other-session', 'group-b']
    ])

    const index = buildCreateSessionSeedIndex(sessions, (candidate) => groupIdBySessionId.get(candidate.id))

    expect(index.latest).toEqual({
      agentId: 'agent-other',
      workspace: { type: 'user', workspaceId: 'workspace-other' }
    })
    expect(index.byGroupId.get('group-a')).toEqual({
      agentId: 'agent-newer',
      workspace: { type: 'user', workspaceId: 'workspace-newer' }
    })
    expect(index.byGroupId.get('group-b')).toEqual({
      agentId: 'agent-other',
      workspace: { type: 'user', workspaceId: 'workspace-other' }
    })
    expect(index.byGroupId.has('group-pinned')).toBe(false)
  })

  it('preserves a null seed when the latest matching session has no agent', () => {
    const index = buildCreateSessionSeedIndex(
      [
        session({
          id: 'older-session',
          agentId: 'agent-older',
          lastActivityAt: '2026-01-02T00:00:00.000Z'
        }),
        session({
          id: 'newer-session',
          agentId: undefined,
          lastActivityAt: '2026-01-03T00:00:00.000Z'
        })
      ],
      () => 'group-a'
    )

    expect(index.latest).toBeNull()
    expect(index.byGroupId.get('group-a')).toBeNull()
  })
})
