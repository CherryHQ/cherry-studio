import '@data/services/AgentTaskService'
import '@data/services/AgentSessionMessageService'

import { application } from '@application'
import { agentWorkspaceHandlers } from '@data/api/handlers/agentWorkspaces'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { pinTable } from '@data/db/schemas/pin'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import path from 'path'
import { beforeEach, describe, expect, it, type Mock } from 'vitest'

describe('agentWorkspaceHandlers integration', () => {
  const dbh = setupTestDatabase()
  const agentId = 'agent-workspace-handler-test'

  beforeEach(async () => {
    ;(application.get('DbService').withWriteTx as Mock).mockImplementation((fn) => dbh.db.transaction(fn as never))
    await dbh.db.insert(agentTable).values({
      id: agentId,
      type: 'claude-code',
      name: 'Workspace Handler Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'a0'
    })
  })

  function workspacePath(name: string): string {
    return path.join('/tmp', 'cherry-workspace-handler', name)
  }

  async function createWorkspace(name: string): Promise<AgentWorkspaceEntity> {
    return dbh.db.transaction((tx) => agentWorkspaceService.findOrCreateByPathTx(tx, workspacePath(name)))
  }

  it('deletes a user workspace and its bound sessions and pins in one handler call', async () => {
    const workspace = await createWorkspace('cascade')
    const first = agentSessionService.create({
      agentId,
      name: 'First',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
    const second = agentSessionService.create({
      agentId,
      name: 'Second',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
    await dbh.db.insert(pinTable).values({
      id: 'pin-first-session',
      entityType: 'session',
      entityId: first.id,
      orderKey: 'a0',
      createdAt: 1,
      updatedAt: 1
    })

    expect(agentSessionService.deleteWorkspaceCascade(workspace.id)).toEqual({
      deletedIds: expect.arrayContaining([first.id, second.id])
    })

    expect(await dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, workspace.id))).toEqual([])
    expect(
      await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.workspaceId, workspace.id))
    ).toEqual([])
    expect(await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, first.id))).toEqual([])
    let err: unknown
    try {
      agentSessionService.getById(second.id)
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects system workspace deletes and preserves the backing session and pin', async () => {
    const session = agentSessionService.create({
      agentId,
      name: 'System Session',
      workspace: { type: 'system' }
    })
    await dbh.db.insert(pinTable).values({
      id: 'pin-system-session',
      entityType: 'session',
      entityId: session.id,
      orderKey: 'a0',
      createdAt: 1,
      updatedAt: 1
    })

    expect(() => agentSessionService.deleteWorkspaceCascade(session.workspace.id)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' })
    )

    const workspaceRows = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, session.workspace.id))
    expect(workspaceRows).toHaveLength(1)
    expect(await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id))).toHaveLength(1)
    expect(await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, session.id))).toHaveLength(1)
  })

  it('lists and resets channel and scheduled-task workspace references', async () => {
    const workspace = await createWorkspace('referenced')
    const channel = agentChannelService.createChannel({
      type: 'telegram',
      name: 'Workspace channel',
      workspace: { type: 'user', workspaceId: workspace.id },
      config: { bot_token: 'test-token' }
    })
    const task = jobScheduleService.create({
      type: 'agent.task',
      name: 'Workspace task',
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: {
        agentId,
        prompt: 'Run in the workspace',
        timeoutMinutes: 2,
        workspace: { type: 'user', workspaceId: workspace.id },
        reuseRevision: 0
      },
      catchUpPolicy: { kind: 'skip-missed' }
    })

    await expect(
      agentWorkspaceHandlers['/agent-workspaces/:workspaceId/references'].GET({
        params: { workspaceId: workspace.id }
      } as never)
    ).resolves.toEqual({
      sessions: { items: [], total: 0 },
      channels: { items: [{ id: channel.id, name: channel.name }], total: 1 },
      tasks: { items: [{ id: task.id, name: task.name }], total: 1 }
    })

    agentSessionService.deleteWorkspaceCascade(workspace.id)

    expect(agentChannelService.getChannel(channel.id)?.workspace).toEqual({ type: 'system' })
    expect(jobScheduleService.getById(task.id)?.jobInputTemplate).toMatchObject({ workspace: { type: 'system' } })
  })

  it('caps workspace reference previews while reporting the full total', async () => {
    const workspace = await createWorkspace('many-references')
    for (let index = 0; index < 23; index += 1) {
      agentSessionService.create({
        agentId,
        name: `Session ${index}`,
        workspace: { type: 'user', workspaceId: workspace.id }
      })
    }

    const references = await agentWorkspaceHandlers['/agent-workspaces/:workspaceId/references'].GET({
      params: { workspaceId: workspace.id }
    } as never)
    if ('data' in references) throw new Error('Expected the default handler response shape')

    expect(references.sessions).toMatchObject({ total: 23 })
    expect(references.sessions.items).toHaveLength(21)
  })
})
