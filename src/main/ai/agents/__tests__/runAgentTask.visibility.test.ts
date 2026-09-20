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

import { type AgentTaskInput, runAgentTask } from '../runAgentTask'

const { startRun } = vi.hoisted(() => ({ startRun: vi.fn() }))
vi.mock('@main/ai/streamManager/api/startAgentSessionRun', () => ({ startAgentSessionRun: startRun }))
vi.mock('../heartbeat', () => ({ readHeartbeat: vi.fn(async () => 'check the inbox') }))
vi.mock('../agentDataDirectory', () => ({ assertAgentStorageDirectory: vi.fn(async () => undefined) }))

describe('scheduled session visibility', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'Agent', instructions: '', orderKey: 'a0' })
      .run()
    const container = application.getContainer()
    const get = container.get.bind(container)
    vi.spyOn(container, 'get').mockImplementation(((name: string) =>
      name === 'ChannelManager' ? { getAdapter: () => undefined } : get(name as never)) as typeof container.get)
    startRun.mockReset().mockResolvedValue({ mode: 'not-started', reason: 'busy' })
  })

  afterEach(() => vi.restoreAllMocks())

  async function run(prompt: string) {
    const workspace = agentWorkspaceService.findOrCreateByPath('/tmp/heartbeat-visibility')
    const input: AgentTaskInput = {
      agentId: 'agent',
      prompt,
      timeoutMinutes: 0,
      workspace: prompt === '__heartbeat__' ? { type: 'user', workspaceId: workspace.id } : { type: 'system' },
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

  it('keeps heartbeat sessions out of navigation even when admission requires a replacement session', async () => {
    startRun.mockResolvedValueOnce({ mode: 'not-started', reason: 'session-invalid' })
    const sessions = await run('__heartbeat__')
    expect(sessions).toHaveLength(2)
    expect(sessions.map((row) => row.type)).toEqual(['background', 'background'])
    expect(agentSessionService.listByCursor().items).toEqual([])
    expect(agentSessionService.getLatestActive()).toBeNull()
  })

  it('keeps ordinary scheduled task sessions available as conversations', async () => {
    const sessions = await run('summarize the project')
    expect(sessions).toHaveLength(1)
    expect(agentSessionService.listByCursor().items.map((row) => row.id)).toEqual([sessions[0].id])
    expect(agentSessionService.getLatestActive()?.id).toBe(sessions[0].id)
    expect(agentSessionService.getById(sessions[0].id).workspace.type).toBe('system')
  })
})
