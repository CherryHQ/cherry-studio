import '@data/services/AgentSessionMessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable, agentTaskSessionTable } from '@data/db/schemas/agentSession'
import { jobTable } from '@data/db/schemas/job'
import { agentSessionService } from '@data/services/AgentSessionService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { loggerService } from '@logger'
import type { startAgentSessionRun } from '@main/ai/streamManager'
import type { JobContext } from '@main/core/job/types'

import type * as AgentDataDirectoryModule from '../agentDataDirectory'
import { type AgentTaskInput, runAgentTask } from '../runAgentTask'

const { startRun, checkStorage, readHeartbeat } = vi.hoisted(() => ({
  startRun: vi.fn<typeof startAgentSessionRun>(),
  checkStorage: vi.fn<() => Promise<void>>(),
  readHeartbeat: vi.fn<() => Promise<string>>()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    ChannelManager: { getAdapter: vi.fn() },
    AiStreamManager: { removeListener: vi.fn() }
  } as never)
})
vi.mock('@main/ai/streamManager/api/startAgentSessionRun', () => ({ startAgentSessionRun: startRun }))
vi.mock('../agentDataDirectory', async (importOriginal) => ({
  ...(await importOriginal<typeof AgentDataDirectoryModule>()),
  assertAgentStorageDirectory: checkStorage
}))
vi.mock('../heartbeat', () => ({ readHeartbeat }))

describe('runAgentTask schedule deletion', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent-task-race',
        type: 'claude-code',
        name: 'Heartbeat agent',
        instructions: '',
        configuration: { heartbeat_enabled: true },
        orderKey: 'a0'
      })
      .run()
    checkStorage.mockReset().mockResolvedValue(undefined)
    readHeartbeat.mockReset().mockResolvedValue('Check pending work')
    startRun.mockReset().mockImplementation(async ({ listeners }) => {
      for (const listener of listeners) {
        listener.onChunk({ type: 'text-delta', id: 'text', delta: 'Finished' })
        await listener.onDone({} as never)
      }
      return { mode: 'started' }
    })
  })

  function createRun(prompt = '__heartbeat__') {
    const input: AgentTaskInput = { agentId: 'agent-task-race', prompt, timeoutMinutes: 0, reuseRevision: 0 }
    const schedule = jobScheduleService.create({
      type: 'agent.task',
      name: 'Heartbeat task',
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: input,
      catchUpPolicy: { kind: 'skip-missed' }
    })
    dbh.db
      .insert(jobTable)
      .values({
        id: 'job-task-race',
        type: 'agent.task',
        status: 'running',
        queue: 'agent-task-race',
        scheduleId: schedule.id,
        scheduledAt: Date.now(),
        input
      })
      .run()
    const ctx: JobContext<AgentTaskInput> = {
      jobId: 'job-task-race',
      parentId: null,
      input,
      attempt: 0,
      signal: new AbortController().signal,
      metadata: {},
      patchMetadata: vi.fn(async () => {}),
      reportProgress: vi.fn(),
      logger: loggerService.withContext('runAgentTask.integration')
    }
    return { ctx, schedule }
  }

  it.each(['storage', 'heartbeat'] as const)(
    'finishes without task provenance when deleted during %s I/O',
    async (stage) => {
      const { ctx, schedule } = createRun()
      if (stage === 'storage') {
        checkStorage.mockImplementationOnce(async () => {
          jobScheduleService.delete(schedule.id)
        })
      } else {
        readHeartbeat.mockImplementationOnce(async () => {
          jobScheduleService.delete(schedule.id)
          return 'Check pending work'
        })
      }

      await expect(runAgentTask(ctx)).resolves.toEqual({ result: 'Finished' })
      const sessions = dbh.db.select().from(agentSessionTable).where(isNull(agentSessionTable.deletedAt)).all()
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({ agentId: ctx.input.agentId, type: 'background' })
      expect(dbh.db.select().from(agentTaskSessionTable).all()).toEqual([])
      expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    }
  )

  it('preserves task provenance when the schedule survives heartbeat I/O', async () => {
    const { ctx, schedule } = createRun()
    await expect(runAgentTask(ctx)).resolves.toEqual({ result: 'Finished' })
    const [session] = dbh.db.select().from(agentSessionTable).all()
    expect(dbh.db.select().from(agentTaskSessionTable).all()).toEqual([{ sessionId: session.id, taskId: schedule.id }])
  })

  it('can re-create a conversation after its schedule and first session are deleted during admission', async () => {
    const { ctx, schedule } = createRun('Summarize work')
    startRun.mockImplementationOnce(async ({ sessionId }) => {
      jobScheduleService.delete(schedule.id)
      agentSessionService.delete(sessionId)
      return { mode: 'not-started', reason: 'session-invalid' }
    })

    await expect(runAgentTask(ctx)).resolves.toEqual({ result: 'Finished' })
    const sessions = dbh.db.select().from(agentSessionTable).where(isNull(agentSessionTable.deletedAt)).all()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ agentId: ctx.input.agentId, type: 'conversation' })
    expect(dbh.db.select().from(agentTaskSessionTable).all()).toEqual([])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
