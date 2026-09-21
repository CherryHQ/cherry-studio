import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { jobScheduleTable } from '@data/db/schemas/job'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'

describe('workspace visibility', () => {
  const dbh = setupTestDatabase()

  function seedBackgroundWorkspace() {
    const workspace = agentWorkspaceService.findOrCreateByPath('/tmp/agent-data/agent')
    dbh.db
      .insert(agentSessionTable)
      .values({
        id: 'heartbeat-session',
        name: 'Heartbeat',
        type: 'background',
        workspaceId: workspace.id,
        orderKey: 'a0'
      })
      .run()
    return workspace
  }

  it('hides background-only workspaces while preserving internal access and history', () => {
    const workspace = seedBackgroundWorkspace()

    expect(agentWorkspaceService.list()).toEqual([])
    expect(agentWorkspaceService.getById(workspace.id)).toEqual(workspace)
    expect(agentWorkspaceService.list({ includeSystem: true }).map((row) => row.id)).toEqual([workspace.id])
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
  })

  it('keeps empty user workspaces visible regardless of their name', () => {
    const workspace = agentWorkspaceService.findOrCreateByPath('/tmp/project', { name: 'Heartbeat — Agent' })
    expect(agentWorkspaceService.list().map((row) => row.id)).toEqual([workspace.id])
  })

  it.each([null, 1])('keeps a workspace with an ordinary conversation (deletedAt=%s)', (deletedAt) => {
    const workspace = seedBackgroundWorkspace()
    dbh.db
      .insert(agentSessionTable)
      .values({
        id: 'conversation',
        name: 'My conversation',
        workspaceId: workspace.id,
        orderKey: 'a1',
        deletedAt
      })
      .run()
    expect(agentWorkspaceService.list().map((row) => row.id)).toEqual([workspace.id])
  })

  it('keeps a workspace referenced by an inactive channel', () => {
    const workspace = seedBackgroundWorkspace()
    dbh.db
      .insert(agentChannelTable)
      .values({
        type: 'telegram',
        name: 'Channel',
        workspace: { type: 'user', workspaceId: workspace.id },
        config: {},
        isActive: false
      })
      .run()
    expect(agentWorkspaceService.list().map((row) => row.id)).toEqual([workspace.id])
  })

  it('keeps a workspace referenced by a disabled ordinary task', () => {
    const workspace = seedBackgroundWorkspace()
    dbh.db
      .insert(jobScheduleTable)
      .values({
        type: 'agent.task',
        name: 'report',
        enabled: false,
        trigger: { kind: 'interval', ms: 60000 },
        jobInputTemplate: {
          agentId: 'agent',
          prompt: 'Report',
          workspace: { type: 'user', workspaceId: workspace.id }
        },
        catchUpPolicy: { kind: 'skip-missed' }
      })
      .run()
    expect(agentWorkspaceService.list().map((row) => row.id)).toEqual([workspace.id])
  })
})
