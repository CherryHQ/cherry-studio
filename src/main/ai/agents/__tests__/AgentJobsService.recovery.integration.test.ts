import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { JobManager } from '@main/core/job/JobManager'
import type { JobHandler } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

vi.mock('../agentTaskJobHandler', () => ({
  agentTaskJobHandler: {
    recovery: 'retry',
    defaultConcurrency: 1,
    async execute() {
      return {}
    }
  } satisfies JobHandler
}))

import { AgentJobsService } from '../AgentJobsService'

const ORPHAN_AGENT_ID = 'agent-orphan'
const LIVE_AGENT_ID = 'agent-live'

const taskTemplate = (agentId: string) => ({
  agentId,
  prompt: 'scheduled task',
  timeoutMinutes: 2,
  workspace: { type: 'system' as const },
  reuseRevision: 0
})

describe('AgentJobsService startup reconciliation integration', () => {
  const dbh = setupTestDatabase()
  let scheduler: SchedulerService
  let jobManager: JobManager

  function seedAgent(id: string): void {
    dbh.db
      .insert(agentTable)
      .values({ id, type: 'claude-code', name: `Agent ${id}`, instructions: '', orderKey: id })
      .run()
  }

  beforeAll(async () => {
    BaseService.resetInstances()
    scheduler = new SchedulerService()
    jobManager = new JobManager()

    const dbSvc = MockMainDbServiceExport.dbService
    dbSvc.withWriteTx.mockImplementation(<T>(fn: (tx: unknown) => T): T => dbh.db.transaction((tx) => fn(tx)))
    const cacheSvc = MockMainCacheServiceExport.cacheService
    ;(application.get as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
      switch (name) {
        case 'DbService':
          return dbSvc
        case 'CacheService':
          return cacheSvc
        case 'SchedulerService':
          return scheduler
        case 'JobManager':
          return jobManager
        case 'PowerService':
          return { preventSleep: () => ({ dispose: () => {} }) }
      }
      throw new Error(`Unexpected application.get('${name}')`)
    })

    await scheduler._doInit()
    await jobManager._doInit()
  })

  afterAll(async () => {
    await jobManager._doStop()
    await scheduler._doStop()
    BaseService.resetInstances()
  })

  it('removes persisted crash residue while preserving a valid task', async () => {
    seedAgent(ORPHAN_AGENT_ID)
    seedAgent(LIVE_AGENT_ID)

    const orphan = jobScheduleService.create({
      type: 'agent.task',
      name: 'orphan',
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: taskTemplate(ORPHAN_AGENT_ID),
      catchUpPolicy: { kind: 'skip-missed' }
    })
    const valid = jobScheduleService.create({
      type: 'agent.task',
      name: 'valid',
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: taskTemplate(LIVE_AGENT_ID),
      catchUpPolicy: { kind: 'skip-missed' }
    })

    // Simulate the crash window: the Agent row committed as deleted, but the
    // post-commit onAgentDeleted schedule cleanup never ran before exit.
    dbh.db.delete(agentTable).where(eq(agentTable.id, ORPHAN_AGENT_ID)).run()

    expect(jobScheduleService.getById(orphan.id)).not.toBeNull()
    expect(jobScheduleService.getById(valid.id)).not.toBeNull()

    const service = new AgentJobsService()
    await service._doInit()

    expect(jobScheduleService.getById(orphan.id)).toBeNull()
    expect(jobScheduleService.getById(valid.id)).not.toBeNull()
    await expect(service.reconcileOrphanedSchedules()).resolves.toBe(0)
  })
})
