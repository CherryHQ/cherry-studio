/**
 * Integration tests for heartbeatSchedule — the configuration→schedule
 * translation that restores the heartbeat producer dropped in the JobManager
 * migration (#19203). Runs against a real file-backed DB with a real
 * JobManager + SchedulerService (mirroring AgentJobsService.test.ts) so the
 * properties under test are the real ones: sentinel-only row identity,
 * in-place repair of migrated rows, pause/resume lifecycle, and timer arming.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { JobManager } from '@main/core/job/JobManager'
import type { JobHandler } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import type { AgentConfiguration } from '@shared/data/types/agent'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

// The real handler pulls in the whole runAgentTask execution chain; the sync
// logic under test only needs SOME registered handler for 'agent.task'.
vi.mock('../agentTaskJobHandler', () => ({
  agentTaskJobHandler: {
    recovery: 'retry',
    defaultConcurrency: 1,
    async execute() {
      return {}
    }
  } satisfies JobHandler
}))

import {
  DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
  repairHeartbeatSchedules,
  syncHeartbeatSchedule
} from '../heartbeatSchedule'

const AGENT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_AGENT_ID = '22222222-2222-4222-8222-222222222222'

function heartbeatRows(agentId: string) {
  return jobScheduleService.listAll({ type: 'agent.task' }).filter((s) => {
    const template = s.jobInputTemplate as { agentId?: unknown; prompt?: unknown }
    return template?.agentId === agentId && template?.prompt === '__heartbeat__'
  })
}

describe('heartbeatSchedule', () => {
  const dbh = setupTestDatabase()
  let scheduler: SchedulerService
  let jobManager: JobManager
  let agentsRoot: string

  /** Insert an agent row and its data directory — what createAgent provisions in production. */
  function seedAgent(
    id: string,
    configuration: AgentConfiguration = {},
    type: 'claude-code' | 'dsh' = 'claude-code'
  ): void {
    mkdirSync(path.join(agentsRoot, id), { recursive: true })
    dbh.db
      .insert(agentTable)
      .values({ id, type, name: `Agent ${id}`, instructions: '', orderKey: id, configuration })
      .run()
  }

  /** Flip the agent's stored heartbeat configuration, as a config save would. */
  function setAgentConfiguration(id: string, configuration: AgentConfiguration): void {
    dbh.db.update(agentTable).set({ configuration }).where(eq(agentTable.id, id)).run()
  }

  beforeAll(async () => {
    BaseService.resetInstances()
    agentsRoot = mkdtempSync(path.join(tmpdir(), 'cs-test-hb-'))
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
      }
      throw new Error(`Unexpected application.get('${name}')`)
    })
    ;(application.getPath as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
      key === 'feature.agents.data' ? agentsRoot : `/mock/${key}`
    )

    await scheduler._doInit()
    await jobManager._doInit()
    jobManager.registerHandler('agent.task', {
      recovery: 'retry',
      defaultConcurrency: 1,
      async execute() {
        return {}
      }
    })
  })

  beforeEach(async () => {
    notifyDataApiDataChangeMock.mockClear()
    for (const { id } of jobScheduleService.listAll({ type: 'agent.task' })) {
      await jobManager.unregisterJobScheduleById(id)
    }
    dbh.db.delete(agentTable).run()
    // The agents root is shared across tests; reset it so seeded files from
    // one test (e.g. a written checklist) cannot leak into the next.
    rmSync(agentsRoot, { recursive: true, force: true })
    mkdirSync(agentsRoot, { recursive: true })
  })

  afterAll(async () => {
    await jobManager._doStop()
    await scheduler._doStop()
    BaseService.resetInstances()
    rmSync(agentsRoot, { recursive: true, force: true })
  })

  it('creates a schedule for an enabled agent and seeds heartbeat.md', async () => {
    seedAgent(AGENT_ID)

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('created')
    const [row] = heartbeatRows(AGENT_ID)
    expect(row).toBeDefined()
    expect(row).toMatchObject({
      name: `heartbeat_${AGENT_ID}`,
      enabled: true,
      trigger: { kind: 'interval', ms: DEFAULT_HEARTBEAT_INTERVAL_MINUTES * 60_000 }
    })
    expect(row.jobInputTemplate).toMatchObject({
      agentId: AGENT_ID,
      prompt: '__heartbeat__',
      workspace: { type: 'user' }
    })
    // Anti-regression for the two-step design: a committed row without a
    // timer is the silent no-op #19203 reported.
    expect(scheduler.has(`schedule:${row.id}`)).toBe(true)
    const seeded = await readFile(path.join(agentsRoot, AGENT_ID, 'heartbeat.md'), 'utf-8')
    expect(seeded).toContain('<!--')
  })

  it('never touches an existing heartbeat.md', async () => {
    seedAgent(AGENT_ID)
    await writeFile(path.join(agentsRoot, AGENT_ID, 'heartbeat.md'), '- real checklist\n')

    await syncHeartbeatSchedule(AGENT_ID)

    const content = await readFile(path.join(agentsRoot, AGENT_ID, 'heartbeat.md'), 'utf-8')
    expect(content).toBe('- real checklist\n')
  })

  it('is idempotent — a second sync is a no-op', async () => {
    seedAgent(AGENT_ID)

    await syncHeartbeatSchedule(AGENT_ID)
    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('noop')
    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
  })

  it('applies a custom interval from the agent configuration', async () => {
    seedAgent(AGENT_ID, { heartbeat_interval: 45 })

    await syncHeartbeatSchedule(AGENT_ID)

    expect(heartbeatRows(AGENT_ID)[0].trigger).toEqual({ kind: 'interval', ms: 45 * 60_000 })
  })

  it('clamps an invalid interval to the default', async () => {
    seedAgent(AGENT_ID, { heartbeat_interval: 0 })

    await syncHeartbeatSchedule(AGENT_ID)

    expect(heartbeatRows(AGENT_ID)[0].trigger).toEqual({
      kind: 'interval',
      ms: DEFAULT_HEARTBEAT_INTERVAL_MINUTES * 60_000
    })
  })

  it('repairs a migrated legacy row in place, preserving its name', async () => {
    seedAgent(AGENT_ID)
    // The v1→v2 migration writes sentinel rows with a system workspace — the
    // shape runAgentTask skips forever. Name stays the v1 literal.
    const { id } = jobManager.registerJobSchedule({
      type: 'agent.task',
      name: 'heartbeat',
      trigger: { kind: 'interval', ms: 3_600_000 },
      jobInputTemplate: {
        agentId: AGENT_ID,
        prompt: '__heartbeat__',
        timeoutMinutes: 2,
        workspace: { type: 'system' },
        reuseRevision: 0
      },
      catchUpPolicy: { kind: 'skip-missed' }
    })

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('updated')
    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
    const row = jobScheduleService.getById(id)
    expect(row?.name).toBe('heartbeat')
    expect(row?.jobInputTemplate).toMatchObject({ workspace: { type: 'user' } })
    expect(scheduler.has(`schedule:${id}`)).toBe(true)
  })

  it('pauses the row when the heartbeat is disabled', async () => {
    seedAgent(AGENT_ID)
    await syncHeartbeatSchedule(AGENT_ID)
    const [row] = heartbeatRows(AGENT_ID)
    setAgentConfiguration(AGENT_ID, { heartbeat_enabled: false })

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('paused')
    expect(jobScheduleService.getById(row.id)?.enabled).toBe(false)
    expect(scheduler.has(`schedule:${row.id}`)).toBe(false)
  })

  it('resumes and repairs a paused row on re-enable', async () => {
    seedAgent(AGENT_ID)
    await syncHeartbeatSchedule(AGENT_ID)
    setAgentConfiguration(AGENT_ID, { heartbeat_enabled: false })
    await syncHeartbeatSchedule(AGENT_ID)
    const [row] = heartbeatRows(AGENT_ID)
    setAgentConfiguration(AGENT_ID, { heartbeat_interval: 15 })

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('updated')
    const updated = jobScheduleService.getById(row.id)
    expect(updated?.enabled).toBe(true)
    expect(updated?.trigger).toEqual({ kind: 'interval', ms: 15 * 60_000 })
    expect(scheduler.has(`schedule:${row.id}`)).toBe(true)
  })

  it('skips runtimes without heartbeat capability', async () => {
    seedAgent(AGENT_ID, {}, 'dsh')

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('skipped-capability')
    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
    await expect(readFile(path.join(agentsRoot, AGENT_ID, 'heartbeat.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns skipped-missing-agent without throwing', async () => {
    await expect(syncHeartbeatSchedule('missing-agent')).resolves.toBe('skipped-missing-agent')
  })

  it('keeps two agents on distinct schedule rows', async () => {
    seedAgent(AGENT_ID)
    seedAgent(OTHER_AGENT_ID)

    await syncHeartbeatSchedule(AGENT_ID)
    await syncHeartbeatSchedule(OTHER_AGENT_ID)

    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
    expect(heartbeatRows(OTHER_AGENT_ID)).toHaveLength(1)
  })

  it('repairHeartbeatSchedules provisions enabled agents and skips disabled ones', async () => {
    seedAgent(AGENT_ID)
    seedAgent(OTHER_AGENT_ID, { heartbeat_enabled: false })

    await repairHeartbeatSchedules()

    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
    expect(heartbeatRows(OTHER_AGENT_ID)).toHaveLength(0)
  })
})
