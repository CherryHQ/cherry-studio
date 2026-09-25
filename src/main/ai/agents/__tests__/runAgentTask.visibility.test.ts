import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import type { JobContext } from '@main/core/job/types'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'

import { type AgentTaskInput, runAgentTask } from '../runAgentTask'

const { startRun } = vi.hoisted(() => ({ startRun: vi.fn() }))
vi.mock('@main/ai/streamManager/api/startAgentSessionRun', () => ({ startAgentSessionRun: startRun }))

describe('scheduled session visibility', () => {
  const dbh = setupTestDatabase()

  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'heartbeat-execution-'))
    await mkdir(path.join(root, 'agent'))
    await writeFile(path.join(root, 'agent', 'heartbeat.md'), 'check the inbox')
    vi.spyOn(application, 'getPath').mockReturnValue(root)
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent',
        type: 'claude-code',
        name: 'Agent',
        instructions: '',
        orderKey: 'a0',
        configuration: { heartbeat_enabled: true }
      })
      .run()
    const container = application.getContainer()
    const get = container.get.bind(container)
    vi.spyOn(container, 'get').mockImplementation(((name: string) =>
      name === 'ChannelManager' ? { getAdapter: () => undefined } : get(name as never)) as typeof container.get)
    startRun.mockReset().mockResolvedValue({ mode: 'not-started', reason: 'busy' })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  async function run(prompt: string, workspace?: AgentSessionWorkspaceSource) {
    const input: AgentTaskInput = {
      agentId: 'agent',
      prompt,
      timeoutMinutes: 0,
      ...(workspace ? { workspace } : {}),
      reuseRevision: 0
    }
    const schedule = jobScheduleService.create({
      type: 'agent.task',
      name: 'scheduled-check',
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: input,
      catchUpPolicy: { kind: 'skip-missed' },
      metadata: { reuse: { enabled: true, revision: 0 } }
    })
    const job = jobService.create({
      type: 'agent.task',
      status: 'running',
      queue: 'agent:agent',
      scheduledAt: Date.now(),
      input,
      scheduleId: schedule.id
    })
    const context: JobContext<AgentTaskInput> = {
      jobId: job.id,
      parentId: null,
      input,
      attempt: 0,
      signal: new AbortController().signal,
      metadata: {},
      patchMetadata: async () => {},
      reportProgress: () => {},
      logger: loggerService.withContext('test')
    }
    // Ordinary tasks in this test use a fresh session; heartbeat must ignore stale reuse settings.
    if (prompt !== '__heartbeat__') jobScheduleService.update(schedule.id, { metadata: {} })
    await runAgentTask(context)
    return dbh.db.select().from(agentSessionTable).all()
  }

  it.each([undefined, { type: 'system' }, { type: 'user', workspaceId: 'deleted-workspace' }] as const)(
    'creates hidden system sessions regardless of the queued workspace source: %j',
    async (workspace) => {
      startRun.mockResolvedValueOnce({ mode: 'not-started', reason: 'session-invalid' })
      const sessions = await run('__heartbeat__', workspace)
      expect(sessions).toHaveLength(2)
      expect(sessions.map((row) => row.type)).toEqual(['background', 'background'])
      expect(agentSessionService.listByCursor().items).toEqual([])
      expect(agentSessionService.getLatestActive()).toBeNull()
      expect(sessions.map((row) => agentSessionService.getById(row.id).workspace.type)).toEqual(['system', 'system'])
      expect(agentWorkspaceService.list()).toEqual([])
      expect(startRun).toHaveBeenCalledWith(
        expect.objectContaining({
          userParts: [{ type: 'text', text: expect.stringContaining('check the inbox') }]
        })
      )
    }
  )

  it('ignores an old heartbeat workspace binding and reads instructions from the agent directory', async () => {
    const project = path.join(root, 'project')
    await mkdir(project)
    await writeFile(path.join(project, 'heartbeat.md'), 'wrong project instructions')
    const workspace = agentWorkspaceService.findOrCreateByPath(project)

    const sessions = await run('__heartbeat__', { type: 'user', workspaceId: workspace.id })

    expect(sessions).toHaveLength(1)
    expect(agentSessionService.getById(sessions[0].id).workspace.type).toBe('system')
    expect(agentWorkspaceService.getById(workspace.id).path).toBe(project)
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userParts: [{ type: 'text', text: expect.stringContaining('check the inbox') }]
      })
    )
    expect(startRun.mock.calls[0][0].userParts[0].text).not.toContain('wrong project instructions')
  })

  it('does not create a session or workspace for an empty heartbeat', async () => {
    await writeFile(path.join(root, 'agent', 'heartbeat.md'), '<!-- no tasks -->')

    expect(await run('__heartbeat__')).toEqual([])
    expect(agentWorkspaceService.list({ includeSystem: true })).toEqual([])
  })

  it('keeps ordinary scheduled task sessions available as conversations', async () => {
    const sessions = await run('summarize the project')
    expect(sessions).toHaveLength(1)
    expect(agentSessionService.listByCursor().items.map((row) => row.id)).toEqual([sessions[0].id])
    expect(agentSessionService.getLatestActive()?.id).toBe(sessions[0].id)
    expect(agentSessionService.getById(sessions[0].id).workspace.type).toBe('system')
  })
})
