/**
 * Integration tests for heartbeatSchedule — the configuration→schedule
 * translation that restores the heartbeat producer dropped in the JobManager
 * migration (#19203). Runs against a real file-backed DB with a real
 * JobManager + SchedulerService (mirroring AgentJobsService.test.ts) so the
 * properties under test are the real ones: sentinel-only row identity,
 * in-place repair of migrated rows, pause/resume lifecycle, and timer arming.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { jobScheduleTable } from '@data/db/schemas/job'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import '@data/services/AgentSessionMessageService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { JobManager } from '@main/core/job/JobManager'
import type { JobContext, JobHandler } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { DEFAULT_HEARTBEAT_INTERVAL_MINUTES } from '@shared/ai/agentHeartbeat'
import type { JobScheduleSnapshot } from '@shared/data/api/schemas/jobs'
import type { AgentConfiguration } from '@shared/data/types/agent'

import type * as HeartbeatModule from '../heartbeat'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

// The real resolver reads PreferenceService through the strict application
// mock; the workspace name only needs a stable, interpolating stand-in.
vi.mock('@main/i18n', () => ({
  t: (key: string, params?: Record<string, string>) =>
    key === 'agent.heartbeat.workspace_name' ? `Heartbeat — ${params?.name}` : key
}))

// The real handler pulls in the whole runAgentTask execution chain; the sync
// logic under test only needs SOME registered handler for 'agent.task'.
// `ensureHeartbeatFile` is re-exported behind an opt-in gate so the drain test
// can hold a sync in flight; every other test passes straight through.
const { heartbeatFileGate } = vi.hoisted(() => ({ heartbeatFileGate: { current: null as Promise<void> | null } }))
vi.mock('../heartbeat', async (importOriginal) => {
  const actual = await importOriginal<typeof HeartbeatModule>()
  return {
    ...actual,
    ensureHeartbeatFile: async (workspacePath: string) => {
      if (heartbeatFileGate.current) await heartbeatFileGate.current
      return actual.ensureHeartbeatFile(workspacePath)
    }
  }
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

vi.mock('@main/ai/streamManager', () => ({ startAgentSessionRun: vi.fn(), ChannelAdapterListener: class {} }))

import { AgentJobsService } from '../AgentJobsService'
import { repairHeartbeatSchedules as repairSchedules } from '../heartbeatSchedule'
import { runAgentTask, type AgentTaskInput } from '../runAgentTask'

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
  let service: AgentJobsService
  const syncHeartbeatSchedule = (id: string, rows?: JobScheduleSnapshot[]) => service.syncHeartbeat(id, rows)
  const drainHeartbeatWork = async (options = { timeoutMs: 15000 }) => (await service.drainInFlight(options)).settled
  const repairHeartbeatSchedules = () => repairSchedules(syncHeartbeatSchedule, new AbortController().signal)

  /** Insert an agent row and its data directory — what createAgent provisions in production. */
  function seedAgent(id: string, configuration: AgentConfiguration = {}, type: string = 'claude-code'): void {
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
    service = new AgentJobsService()

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
        case 'AgentJobsService':
          return service
      }
      throw new Error(`Unexpected application.get('${name}')`)
    })
    ;(application.getPath as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
      key === 'feature.agents.data' ? agentsRoot : `/mock/${key}`
    )

    await scheduler._doInit()
    await jobManager._doInit()
    await service._doInit()
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
    await service._doStop()
    await jobManager._doStop()
    await scheduler._doStop()
    BaseService.resetInstances()
    rmSync(agentsRoot, { recursive: true, force: true })
  })

  it('removes a newly created workspace when heartbeat.md is a directory', async () => {
    seedAgent(AGENT_ID)
    mkdirSync(path.join(agentsRoot, AGENT_ID, 'heartbeat.md'))

    await syncHeartbeatSchedule(AGENT_ID)

    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(0)
  })

  it('preserves a breaker stop committed while re-enable waits for file IO', async () => {
    seedAgent(AGENT_ID)
    await syncHeartbeatSchedule(AGENT_ID)
    setAgentConfiguration(AGENT_ID, { heartbeat_enabled: false })
    await syncHeartbeatSchedule(AGENT_ID)
    const [row] = heartbeatRows(AGENT_ID)
    setAgentConfiguration(AGENT_ID, { heartbeat_enabled: true })
    let release!: () => void
    heartbeatFileGate.current = new Promise<void>((resolve) => {
      release = resolve
    })
    const ensure = vi.spyOn(await import('../heartbeat'), 'ensureHeartbeatFile')
    const pending = syncHeartbeatSchedule(AGENT_ID)
    await vi.waitFor(() => expect(ensure).toHaveBeenCalled())
    application
      .get('DbService')
      .withWriteTx((tx) =>
        jobManager.updateJobScheduleTx(tx, row.id, { enabled: false, metadata: { circuitBreakerPaused: true } })
      )
    release()
    heartbeatFileGate.current = null
    await pending
    ensure.mockRestore()

    expect(jobScheduleService.getById(row.id)?.enabled).toBe(false)
    expect(scheduler.has(`schedule:${row.id}`)).toBe(false)
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

  it('keeps the committed schedule when arming its timer fails', async () => {
    seedAgent(AGENT_ID)
    const spy = vi.spyOn(jobManager, 'syncJobScheduleTimerById').mockImplementation(() => {
      throw new Error('timer registration failed')
    })

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    // The row is the source of truth once committed; a failed arm is logged
    // and recovered by the next sync or restart, not thrown as sync failure.
    expect(outcome).toBe('created')
    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
    spy.mockRestore()
  })

  it('reaps agent.task rows whose producer agent is gone (failed deletion sweep)', async () => {
    seedAgent(AGENT_ID)
    await syncHeartbeatSchedule(AGENT_ID)
    const [row] = heartbeatRows(AGENT_ID)
    expect(row).toBeDefined()
    // Simulate the residue of a deletion sweep whose unregister failed: the
    // agent is gone but the schedule row (and its workspace) outlive it.
    const workspaceId = (row.jobInputTemplate as { workspace: { workspaceId: string } }).workspace.workspaceId
    expect(dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, workspaceId)).all()).toHaveLength(
      1
    )
    dbh.db.delete(agentTable).where(eq(agentTable.id, AGENT_ID)).run()

    await repairHeartbeatSchedules()

    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
    expect(dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, workspaceId)).all()).toHaveLength(
      0
    )
  })

  it('keeps an ordinary task workspace when reaping its orphaned non-heartbeat row', async () => {
    // The reaper mirrors the deletion sweep's workspace rule: only a
    // heartbeat's provisioned row goes — a user task's own picked workspace
    // outlives its producer agent.
    dbh.db
      .insert(agentWorkspaceTable)
      .values({
        id: 'ws-user-task',
        name: 'Project workspace',
        path: path.join(agentsRoot, 'user-task-ws'),
        type: 'user',
        orderKey: 'ws-user-task'
      })
      .run()
    jobManager.registerJobSchedule({
      type: 'agent.task',
      name: 'task_daily_report',
      trigger: { kind: 'interval', ms: 3_600_000 },
      jobInputTemplate: {
        agentId: AGENT_ID,
        prompt: 'Write the daily report',
        timeoutMinutes: 2,
        workspace: { type: 'user', workspaceId: 'ws-user-task' },
        reuseRevision: 0
      },
      catchUpPolicy: { kind: 'skip-missed' }
    })

    await repairHeartbeatSchedules()

    expect(
      jobScheduleService.listAll({ type: 'agent.task' }).filter((s) => s.name === 'task_daily_report')
    ).toHaveLength(0)
    expect(
      dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, 'ws-user-task')).all()
    ).toHaveLength(1)
  })

  it('pauses an orphaned row the reaper cannot unregister', async () => {
    seedAgent(AGENT_ID)
    await syncHeartbeatSchedule(AGENT_ID)
    const [row] = heartbeatRows(AGENT_ID)
    dbh.db.delete(agentTable).where(eq(agentTable.id, AGENT_ID)).run()
    const spy = vi.spyOn(jobManager, 'unregisterJobScheduleById').mockRejectedValue(new Error('SQLITE_BUSY'))

    await repairHeartbeatSchedules()

    // Left armed it would throw on every fire for a dead agent; the pause is
    // best-effort so the reap failure still goes inert.
    expect(jobScheduleService.getById(row.id)?.enabled).toBe(false)
    spy.mockRestore()
  })

  it('never touches an existing heartbeat.md', async () => {
    seedAgent(AGENT_ID)
    await writeFile(path.join(agentsRoot, AGENT_ID, 'heartbeat.md'), '- real checklist\n')

    await syncHeartbeatSchedule(AGENT_ID)

    const content = await readFile(path.join(agentsRoot, AGENT_ID, 'heartbeat.md'), 'utf-8')
    expect(content).toBe('- real checklist\n')
  })

  it('recreates a missing agent data directory and still seeds heartbeat.md', async () => {
    seedAgent(AGENT_ID)
    // Simulate a migrated/corrupted install: the row exists but the directory is gone.
    rmSync(path.join(agentsRoot, AGENT_ID), { recursive: true, force: true })

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('created')
    const seeded = await readFile(path.join(agentsRoot, AGENT_ID, 'heartbeat.md'), 'utf-8')
    expect(seeded).toContain('<!--')
  })

  it('pauses the schedule when heartbeat.md is occupied by a non-regular file', async () => {
    // A directory (or symlink) at heartbeat.md makes every tick fail its
    // read — leaving the row armed would fire completed skips forever.
    seedAgent(AGENT_ID)
    await syncHeartbeatSchedule(AGENT_ID)
    const [row] = heartbeatRows(AGENT_ID)
    expect(row?.enabled).toBe(true)
    rmSync(path.join(agentsRoot, AGENT_ID, 'heartbeat.md'))
    mkdirSync(path.join(agentsRoot, AGENT_ID, 'heartbeat.md'))

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('skipped-untrusted-path')
    expect(jobScheduleService.getById(row.id)?.enabled).toBe(false)
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

  it('never arms a 0ms trigger when a sub-minute interval rounds down', async () => {
    // 0.4 min rounds to 0 — a bare Math.round would produce a 0ms interval;
    // the clamp must hold the floor at 1 minute (the UI's lower bound).
    seedAgent(AGENT_ID, { heartbeat_interval: 0.4 })

    await syncHeartbeatSchedule(AGENT_ID)

    expect(heartbeatRows(AGENT_ID)[0].trigger).toEqual({ kind: 'interval', ms: 60_000 })
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

  it('pauses ALL duplicate heartbeat rows when the heartbeat is disabled', async () => {
    // Migration disambiguation can leave two identity-matching rows; pausing
    // only the first would keep the duplicate firing on the disabled path.
    seedAgent(AGENT_ID, { heartbeat_enabled: false })
    for (const name of [`heartbeat_${AGENT_ID}`, 'heartbeat_legacy_disambiguated']) {
      jobManager.registerJobSchedule({
        type: 'agent.task',
        name,
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
    }

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('paused')
    for (const row of heartbeatRows(AGENT_ID)) {
      expect(row.enabled).toBe(false)
    }
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

  it('repairs a row that drifted only in reuseRevision', async () => {
    // reuseRevision is read at run time, so a drift in it alone must not be
    // reported as 'noop' — that would leave the stale revision committed.
    seedAgent(AGENT_ID)
    await syncHeartbeatSchedule(AGENT_ID)
    const [row] = heartbeatRows(AGENT_ID)
    const template = row.jobInputTemplate as { reuseRevision: number }
    dbh.db
      .update(jobScheduleTable)
      .set({ jobInputTemplate: { ...template, reuseRevision: template.reuseRevision + 1 } })
      .where(eq(jobScheduleTable.id, row.id))
      .run()

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('updated')
    expect(jobScheduleService.getById(row.id)?.jobInputTemplate).toMatchObject({
      reuseRevision: 0
    })
  })

  it('treats a concurrent create name-conflict as a benign race and repairs the winner', async () => {
    // Simulate a concurrent sync that registered the row against a snapshot
    // this caller cannot see: pass an empty snapshot so the create branch runs,
    // then let the INSERT collide with the pre-existing (type, name) row. The
    // sync must not throw — it re-reads the winner and repairs it in place.
    seedAgent(AGENT_ID)
    const { id } = jobManager.registerJobSchedule({
      type: 'agent.task',
      name: `heartbeat_${AGENT_ID}`,
      trigger: { kind: 'interval', ms: DEFAULT_HEARTBEAT_INTERVAL_MINUTES * 60_000 },
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
    // The winner was repaired to the canonical shape the sync would have written.
    expect(jobScheduleService.getById(id)?.jobInputTemplate).toMatchObject({
      workspace: { type: 'user' },
      reuseRevision: 0
    })
    expect(scheduler.has(`schedule:${id}`)).toBe(true)
  })

  it('treats a name-conflict winner with a corrupted sentinel as benign (fallback identity)', async () => {
    // A whitespace-corrupted sentinel on the reserved name is still this
    // agent's heartbeat row via the self-heal fallback — the create-race path
    // must repair it in place, not misclassify it as foreign and rethrow.
    seedAgent(AGENT_ID)
    const { id } = jobManager.registerJobSchedule({
      type: 'agent.task',
      name: `heartbeat_${AGENT_ID}`,
      trigger: { kind: 'interval', ms: DEFAULT_HEARTBEAT_INTERVAL_MINUTES * 60_000 },
      jobInputTemplate: {
        agentId: AGENT_ID,
        prompt: '__heartbeat__ ',
        timeoutMinutes: 2,
        workspace: { type: 'system' },
        reuseRevision: 0
      },
      catchUpPolicy: { kind: 'skip-missed' }
    })

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('updated')
    expect(jobScheduleService.getById(id)?.jobInputTemplate).toMatchObject({
      prompt: '__heartbeat__',
      workspace: { type: 'user' }
    })
    expect(scheduler.has(`schedule:${id}`)).toBe(true)
  })

  it("converges under a disambiguated name when a foreign row squats this agent's reserved name", async () => {
    // A non-heartbeat schedule that happens to share the reserved heartbeat
    // name (created before this agent existed, manual DB edit, legacy row)
    // must not be silently overwritten — but rethrowing would wedge every
    // future sync on the same UNIQUE conflict, so sync registers under a
    // disambiguated name instead (identity is sentinel-based, not the name).
    seedAgent(AGENT_ID)
    seedAgent(OTHER_AGENT_ID)
    const foreignName = `heartbeat_${AGENT_ID}`
    const { id } = jobManager.registerJobSchedule({
      type: 'agent.task',
      name: foreignName,
      // Different agent + a real (non-sentinel) prompt: an ordinary task row,
      // not the heartbeat this sync is trying to create.
      trigger: { kind: 'interval', ms: 5 * 60_000 },
      jobInputTemplate: {
        agentId: OTHER_AGENT_ID,
        prompt: 'run my report',
        timeoutMinutes: 2,
        workspace: { type: 'system' },
        reuseRevision: 0
      },
      catchUpPolicy: { kind: 'skip-missed' }
    })
    const templateBefore = structuredClone(jobScheduleService.getById(id)?.jobInputTemplate)

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('created')
    // The non-heartbeat row must be untouched: same id, same template, still enabled.
    const row = jobScheduleService.getById(id)
    expect(row?.jobInputTemplate).toEqual(templateBefore)
    expect(row?.enabled).toBe(true)
    expect(row?.trigger).toEqual({ kind: 'interval', ms: 5 * 60_000 })
    expect(row?.name).toBe(foreignName)
    // The heartbeat converged under a disambiguated label.
    const hb = heartbeatRows(AGENT_ID)
    expect(hb).toHaveLength(1)
    expect(hb[0].name).toMatch(new RegExp(`^${foreignName}__[0-9a-f]{8}$`))
  })

  it('scans the schedule table once across all agents in the repair pass', async () => {
    // Regression for the O(agents × schedules) startup pass: each agent used
    // to trigger its own listAll. The pass must snapshot once and reuse it.
    seedAgent(AGENT_ID)
    seedAgent(OTHER_AGENT_ID)
    const listAllSpy = vi.spyOn(jobScheduleService, 'listAll')

    await repairHeartbeatSchedules()

    expect(listAllSpy).toHaveBeenCalledTimes(1)
    listAllSpy.mockRestore()
    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
    expect(heartbeatRows(OTHER_AGENT_ID)).toHaveLength(1)
  })

  it('repairs a row whose sentinel prompt was corrupted in place', async () => {
    // The corrupted prompt breaks sentinel identity; the reserved name +
    // template agentId must still find the row so drift repair can heal it.
    seedAgent(AGENT_ID)
    const { id } = jobManager.registerJobSchedule({
      type: 'agent.task',
      name: `heartbeat_${AGENT_ID}`,
      trigger: { kind: 'interval', ms: 3_600_000 },
      jobInputTemplate: {
        agentId: AGENT_ID,
        prompt: '__heartbeat__ ',
        timeoutMinutes: 2,
        workspace: { type: 'system' },
        reuseRevision: 0
      },
      catchUpPolicy: { kind: 'skip-missed' }
    })

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('updated')
    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
    expect(jobScheduleService.getById(id)?.jobInputTemplate).toMatchObject({
      prompt: '__heartbeat__',
      workspace: { type: 'user' }
    })
    expect(scheduler.has(`schedule:${id}`)).toBe(true)
  })

  it('never rewrites a user task that owns the reserved heartbeat name', async () => {
    // Pre-reservation data or a manual DB edit: same agent, reserved name, but
    // a real user prompt. The self-heal fallback must not claim the row — sync
    // converges under a disambiguated name instead of overwriting the prompt.
    seedAgent(AGENT_ID)
    const { id } = jobManager.registerJobSchedule({
      type: 'agent.task',
      name: `heartbeat_${AGENT_ID}`,
      trigger: { kind: 'interval', ms: 5 * 60_000 },
      jobInputTemplate: {
        agentId: AGENT_ID,
        prompt: 'run my report',
        timeoutMinutes: 2,
        workspace: { type: 'system' },
        reuseRevision: 0
      },
      catchUpPolicy: { kind: 'skip-missed' }
    })
    const templateBefore = structuredClone(jobScheduleService.getById(id)?.jobInputTemplate)

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('created')
    const row = jobScheduleService.getById(id)
    expect(row?.jobInputTemplate).toEqual(templateBefore)
    expect(row?.enabled).toBe(true)
    expect(row?.name).toBe(`heartbeat_${AGENT_ID}`)
    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
  })

  it('treats a same-agent reserved-name row with a non-string prompt as foreign', async () => {
    // jobInputTemplate is z.unknown(): legacy/manual writes can hold
    // prompt: null. The self-heal fallback only claims a string that trims to
    // the sentinel — a non-string prompt is not a corrupted heartbeat, and
    // repair would overwrite the template wholesale.
    seedAgent(AGENT_ID)
    const { id } = jobManager.registerJobSchedule({
      type: 'agent.task',
      name: `heartbeat_${AGENT_ID}`,
      trigger: { kind: 'interval', ms: 5 * 60_000 },
      jobInputTemplate: {
        agentId: AGENT_ID,
        // The column is z.unknown() at runtime; the register helper types it
        // tighter, so the corrupt-row fixture needs the cast.
        prompt: null as never,
        timeoutMinutes: 2,
        workspace: { type: 'system' },
        reuseRevision: 0
      },
      catchUpPolicy: { kind: 'skip-missed' }
    })
    const templateBefore = structuredClone(jobScheduleService.getById(id)?.jobInputTemplate)

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('created')
    expect(jobScheduleService.getById(id)?.jobInputTemplate).toEqual(templateBefore)
    const hb = heartbeatRows(AGENT_ID)
    expect(hb).toHaveLength(1)
    expect(hb[0].id).not.toBe(id)
  })

  it('serializes same-agent syncs — a racing config save reads fresh and commits last', async () => {
    // Without the per-agent chain both syncs would read the configuration
    // before either commits, letting the slower one write a stale interval.
    seedAgent(AGENT_ID, { heartbeat_interval: 30 })
    const events: string[] = []
    const originalGetAgent = agentService.getAgent.bind(agentService)
    const spy = vi.spyOn(agentService, 'getAgent').mockImplementation((id: string) => {
      if (id === AGENT_ID) events.push('read')
      return originalGetAgent(id)
    })

    const first = syncHeartbeatSchedule(AGENT_ID).then((outcome) => {
      events.push('first-settled')
      return outcome
    })
    // The chain defers the first sync's config read to a microtask — wait for
    // it, or the configuration flip below would land before the read.
    await vi.waitFor(() => {
      if (!events.includes('read')) throw new Error('first sync has not read the configuration yet')
    })
    setAgentConfiguration(AGENT_ID, { heartbeat_interval: 45 })
    const second = syncHeartbeatSchedule(AGENT_ID)

    const [firstOutcome, secondOutcome] = await Promise.all([first, second])
    spy.mockRestore()

    expect(firstOutcome).toBe('created')
    expect(secondOutcome).toBe('updated')

    const [row] = heartbeatRows(AGENT_ID)
    expect(row.trigger).toEqual({ kind: 'interval', ms: 45 * 60_000 })
  })

  it('skips provisioning when the agent data directory symlinks outside managed storage', async () => {
    seedAgent(AGENT_ID)
    const outside = mkdtempSync(path.join(tmpdir(), 'cs-test-hb-escape-'))
    rmSync(path.join(agentsRoot, AGENT_ID), { recursive: true, force: true })
    symlinkSync(outside, path.join(agentsRoot, AGENT_ID))

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('skipped-untrusted-path')
    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
    expect(existsSync(path.join(outside, 'heartbeat.md'))).toBe(false)
    rmSync(outside, { recursive: true, force: true })
  })

  it('pauses a previously-armed row while the agent data path is untrusted, and re-arms after recovery', async () => {
    // An earlier test in this suite leaves a symlink at this path; clear it
    // so seedAgent provisions a real directory regardless of platform.
    rmSync(path.join(agentsRoot, AGENT_ID), { recursive: true, force: true })
    seedAgent(AGENT_ID)
    await syncHeartbeatSchedule(AGENT_ID)
    expect(heartbeatRows(AGENT_ID)[0]?.enabled).toBe(true)

    const outside = mkdtempSync(path.join(tmpdir(), 'cs-test-hb-untrusted-'))
    rmSync(path.join(agentsRoot, AGENT_ID), { recursive: true, force: true })
    symlinkSync(outside, path.join(agentsRoot, AGENT_ID))
    try {
      // A plain pause (no breaker marker): the row must not keep firing
      // completed skip jobs against the untrusted path, and the next
      // successful sync re-arms it without a toggle reset.
      const outcome = await syncHeartbeatSchedule(AGENT_ID)
      expect(outcome).toBe('skipped-untrusted-path')
      expect(heartbeatRows(AGENT_ID)[0]?.enabled).toBe(false)
    } finally {
      rmSync(path.join(agentsRoot, AGENT_ID), { recursive: true, force: true })
    }
    mkdirSync(path.join(agentsRoot, AGENT_ID), { recursive: true })

    const healed = await syncHeartbeatSchedule(AGENT_ID)
    expect(healed).toBe('updated')
    expect(heartbeatRows(AGENT_ID)[0]?.enabled).toBe(true)
    rmSync(outside, { recursive: true, force: true })
  })

  it('pauses a previously-armed row when the runtime loses the heartbeat capability', async () => {
    seedAgent(AGENT_ID)
    await syncHeartbeatSchedule(AGENT_ID)
    const [row] = heartbeatRows(AGENT_ID)
    expect(row.enabled).toBe(true)

    // The agent's type is migrated to a runtime without heartbeat support
    // (or the capability is revoked) while a schedule row exists.
    dbh.db.update(agentTable).set({ type: 'dsh' }).where(eq(agentTable.id, AGENT_ID)).run()

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('skipped-capability')
    expect(jobScheduleService.getById(row.id)?.enabled).toBe(false)
  })

  it('keeps archived heartbeat schedules during explicit sync and startup orphan repair', async () => {
    seedAgent(AGENT_ID)
    await syncHeartbeatSchedule(AGENT_ID)
    const [row] = heartbeatRows(AGENT_ID)
    dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, AGENT_ID)).run()
    await jobManager.pauseJobScheduleById(row.id)

    await syncHeartbeatSchedule(AGENT_ID)
    await repairHeartbeatSchedules()

    expect(jobScheduleService.getById(row.id)).toMatchObject({ enabled: false })
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
    expect(scheduler.has(`schedule:${row.id}`)).toBe(false)
  })

  it('retains and pauses a heartbeat created while its agent moves into trash', async () => {
    seedAgent(AGENT_ID)
    const original = agentWorkspaceService.findOrCreateByPathResult.bind(agentWorkspaceService)
    const spy = vi.spyOn(agentWorkspaceService, 'findOrCreateByPathResult').mockImplementation((...args) => {
      dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, AGENT_ID)).run()
      return original(...args)
    })
    try {
      await syncHeartbeatSchedule(AGENT_ID)
    } finally {
      spy.mockRestore()
    }

    const [row] = heartbeatRows(AGENT_ID)
    expect(row).toMatchObject({ enabled: false, metadata: { agentTrash: { resumeOnRestore: true } } })
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
    expect(scheduler.has(`schedule:${row.id}`)).toBe(false)
  })

  it('removes the row when the agent is deleted mid-sync', async () => {
    // The agent row disappears after sync's existence check but before the
    // schedule commit — the onAgentDeleted sweep has already run, so the
    // committed row would be orphaned without the post-commit re-check.
    seedAgent(AGENT_ID)
    const original = agentWorkspaceService.findOrCreateByPathResult.bind(agentWorkspaceService)
    const spy = vi.spyOn(agentWorkspaceService, 'findOrCreateByPathResult').mockImplementation((...args) => {
      dbh.db.delete(agentTable).where(eq(agentTable.id, AGENT_ID)).run()
      return original(...args)
    })

    const outcome = await syncHeartbeatSchedule(AGENT_ID)
    spy.mockRestore()

    expect(outcome).toBe('skipped-missing-agent')
    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
    expect(jobScheduleService.listAll({ type: 'agent.task' })).toHaveLength(0)
    // The workspace this sync created is rolled back along with the schedule.
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(0)
  })

  it('unregisters a repaired row when the agent is deleted mid-sync', async () => {
    // Same guard, the other write path: here the row already existed, so the
    // sync did not create it — `finalize` must still undo the repair it just
    // committed, or the onAgentDeleted sweep (already run) leaves it firing.
    seedAgent(AGENT_ID)
    await syncHeartbeatSchedule(AGENT_ID)
    const row = heartbeatRows(AGENT_ID)[0]
    // Drift the row so the second sync takes the repair branch rather than noop.
    setAgentConfiguration(AGENT_ID, { heartbeat_interval: 45 })

    const original = agentWorkspaceService.findOrCreateByPathResult.bind(agentWorkspaceService)
    const spy = vi.spyOn(agentWorkspaceService, 'findOrCreateByPathResult').mockImplementation((...args) => {
      dbh.db.delete(agentTable).where(eq(agentTable.id, AGENT_ID)).run()
      return original(...args)
    })

    const outcome = await syncHeartbeatSchedule(AGENT_ID)
    spy.mockRestore()

    expect(outcome).toBe('skipped-missing-agent')
    expect(jobScheduleService.getById(row.id)).toBeNull()
    // The workspace predated this sync (find-or-create reused it), so the
    // deletion path must leave it alone — only rows this sync created roll back.
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
  })

  it('unregisters a paused row when the agent is deleted mid-sync', async () => {
    // Third write path: the toggle-off branch pauses rows via
    // pauseHeartbeatRows, and those ids land in touchedScheduleIds too — a
    // pause committed after the deletion sweep is as orphaned as a create.
    seedAgent(AGENT_ID)
    await syncHeartbeatSchedule(AGENT_ID)
    const row = heartbeatRows(AGENT_ID)[0]
    setAgentConfiguration(AGENT_ID, { heartbeat_enabled: false })

    const original = jobManager.updateJobScheduleTx.bind(jobManager)
    const spy = vi.spyOn(jobManager, 'updateJobScheduleTx').mockImplementation((...args) => {
      dbh.db.delete(agentTable).where(eq(agentTable.id, AGENT_ID)).run()
      return original(...args)
    })

    const outcome = await syncHeartbeatSchedule(AGENT_ID)
    spy.mockRestore()

    expect(outcome).toBe('skipped-missing-agent')
    expect(jobScheduleService.getById(row.id)).toBeNull()
  })

  it('drains the syncs a repair pass enqueues while it settles', async () => {
    // The drain's loop exists because settling work enqueues follow-ups: the
    // repair pass is tracked as one unit and each of its per-agent syncs is
    // tracked again, so a single allSettled round would return while the
    // syncs are still writing.
    seedAgent(AGENT_ID)
    seedAgent(OTHER_AGENT_ID)

    const repair = repairHeartbeatSchedules()
    await expect(drainHeartbeatWork()).resolves.toBe(true)
    await repair

    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
    expect(heartbeatRows(OTHER_AGENT_ID)).toHaveLength(1)
  })

  it('reports the deadline instead of stalling on a sync that outlives stop()', async () => {
    // Shutdown contract of the exported drain: a producer that never settles
    // must not hold `stop()` open. `ensureHeartbeatFile` is the seam because
    // it is the sync's only awaited step it does not own itself.
    seedAgent(AGENT_ID)
    let release!: () => void
    heartbeatFileGate.current = new Promise<void>((resolve) => {
      release = resolve
    })

    const sync = syncHeartbeatSchedule(AGENT_ID)
    await expect(drainHeartbeatWork({ timeoutMs: 50 })).resolves.toBe(false)

    release()
    heartbeatFileGate.current = null
    await expect(sync).resolves.toBe('created')
    await expect(drainHeartbeatWork()).resolves.toBe(true)
  })

  it('rolls back a newly created workspace row when heartbeat-file provisioning fails', async () => {
    // The workspace is created before heartbeat.md so a SYSTEM-owned path
    // leaves no orphaned file — but the reverse failure (file provisioning
    // fails after the workspace insert) must not orphan the workspace row.
    seedAgent(AGENT_ID)
    chmodSync(path.join(agentsRoot, AGENT_ID), 0o555)

    await expect(syncHeartbeatSchedule(AGENT_ID)).rejects.toThrow()

    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(0)
  })

  it('rolls back a newly created workspace row when schedule registration fails', async () => {
    // Same orphan rule, later failure point: the register throws after the
    // workspace insert (and after the file seeded) — the workspace row must
    // not survive a sync that produced no schedule.
    seedAgent(AGENT_ID)
    const spy = vi.spyOn(jobManager, 'registerJobScheduleTx').mockImplementationOnce(() => {
      throw new Error('register blew up')
    })

    await expect(syncHeartbeatSchedule(AGENT_ID)).rejects.toThrow('register blew up')
    spy.mockRestore()

    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(0)
  })

  it('does not re-arm the timer when only the job-input template drifted', async () => {
    // Re-arming an enabled interval resets its phase — a template-only repair
    // must leave the cadence untouched (the armed callback re-reads the row).
    seedAgent(AGENT_ID, { heartbeat_interval: 45 })
    await syncHeartbeatSchedule(AGENT_ID)
    const [row] = heartbeatRows(AGENT_ID)
    dbh.db
      .update(jobScheduleTable)
      .set({ jobInputTemplate: { ...(row.jobInputTemplate as object), reuseRevision: 3 } })
      .where(eq(jobScheduleTable.id, row.id))
      .run()
    const spy = vi.spyOn(jobManager, 'syncJobScheduleTimerById')

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('updated')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    expect(jobScheduleService.getById(row.id)?.jobInputTemplate).toMatchObject({ reuseRevision: 0 })
  })

  it('skips an agent type missing from the capabilities table', async () => {
    seedAgent(AGENT_ID, {}, 'legacy-removed-runtime')

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('skipped-capability')
    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
  })

  it('warns for a runtime name colliding with an Object prototype key', async () => {
    // "constructor" passes an `in` membership test via the prototype chain —
    // the diagnostic warn must still fire (hasOwn), not a silent skip.
    seedAgent(AGENT_ID, {}, 'constructor')
    const warnSpy = vi.spyOn(loggerService.withContext('HeartbeatSchedule'), 'warn').mockImplementation(() => undefined)

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('skipped-capability')
    expect(warnSpy).toHaveBeenCalledWith(
      'Agent runtime missing from the capabilities table; heartbeat not armed',
      expect.objectContaining({ agentId: AGENT_ID })
    )
    warnSpy.mockRestore()
    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
  })

  it('converges duplicate heartbeat rows for one agent to a single schedule', async () => {
    // A migration-disambiguated row (renamed by the v1→v2 UNIQUE handling)
    // can coexist with the canonical one — without convergence both fire.
    seedAgent(AGENT_ID, { heartbeat_interval: 45 })
    jobManager.registerJobSchedule({
      type: 'agent.task',
      name: 'heartbeat_legacy_disambiguated',
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
    jobManager.registerJobSchedule({
      type: 'agent.task',
      name: `heartbeat_${AGENT_ID}`,
      trigger: { kind: 'interval', ms: 7_200_000 },
      jobInputTemplate: {
        agentId: AGENT_ID,
        prompt: '__heartbeat__',
        timeoutMinutes: 2,
        workspace: { type: 'system' },
        reuseRevision: 0
      },
      catchUpPolicy: { kind: 'skip-missed' }
    })

    await syncHeartbeatSchedule(AGENT_ID)

    const survivors = heartbeatRows(AGENT_ID)
    expect(survivors).toHaveLength(1)
    expect(survivors[0].trigger).toEqual({ kind: 'interval', ms: 45 * 60_000 })
    expect(survivors[0].enabled).toBe(true)
  })

  it('pauses a duplicate heartbeat row the reconciliation fails to unregister', async () => {
    // A transient unregister failure must not leave the duplicate armed next
    // to the canonical row until the next restart — the pause mirrors the
    // deletion sweep's best-effort fallback.
    seedAgent(AGENT_ID, { heartbeat_interval: 45 })
    jobManager.registerJobSchedule({
      type: 'agent.task',
      name: 'heartbeat_legacy_disambiguated',
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
    jobManager.registerJobSchedule({
      type: 'agent.task',
      name: `heartbeat_${AGENT_ID}`,
      trigger: { kind: 'interval', ms: 7_200_000 },
      jobInputTemplate: {
        agentId: AGENT_ID,
        prompt: '__heartbeat__',
        timeoutMinutes: 2,
        workspace: { type: 'system' },
        reuseRevision: 0
      },
      catchUpPolicy: { kind: 'skip-missed' }
    })
    const spy = vi.spyOn(jobManager, 'unregisterJobScheduleById').mockRejectedValue(new Error('SQLITE_BUSY'))

    await syncHeartbeatSchedule(AGENT_ID)

    // Whichever sentinel row sync picked as canonical, the OTHER one is the
    // removal target — it must come out of the failed removal disabled.
    const removalTarget = spy.mock.calls[0]?.[0]
    spy.mockRestore()
    expect(removalTarget).toBeDefined()
    expect(jobScheduleService.getById(removalTarget)?.enabled).toBe(false)
    expect(heartbeatRows(AGENT_ID).filter((row) => row.enabled)).toHaveLength(1)
  })

  it('repairs a circuit-breaker-paused row without re-enabling it', async () => {
    // The breaker pause is a stop signal (3 consecutive failed runs), not
    // drift — re-arming it on every sync would defeat the cost protection.
    seedAgent(AGENT_ID, { heartbeat_interval: 45 })
    const { id } = jobManager.registerJobSchedule({
      type: 'agent.task',
      name: `heartbeat_${AGENT_ID}`,
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
    dbh.db
      .update(jobScheduleTable)
      .set({ enabled: false, metadata: { circuitBreakerPaused: true } })
      .where(eq(jobScheduleTable.id, id))
      .run()
    const spy = vi.spyOn(jobManager, 'syncJobScheduleTimerById')

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('updated')
    const row = jobScheduleService.getById(id)
    expect(row?.enabled).toBe(false)
    expect(row?.trigger).toEqual({ kind: 'interval', ms: 45 * 60_000 })
    expect(row?.jobInputTemplate).toMatchObject({ workspace: { type: 'user' } })
    // The trigger drift is persisted but the timer is NOT re-armed — the row
    // stays stopped until the user resets via the heartbeat toggle off/on.
    // (The breaker's own pause disposed the timer; sync must not revive it.)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('keeps the circuit-breaker marker when a capability gate pauses the row', async () => {
    // Only the user's toggle-off resets a breaker stop; a capability-gated
    // pause (runtime lost heartbeat support) must preserve the marker, or
    // restoring the capability would silently re-arm a stopped schedule.
    seedAgent(AGENT_ID)
    const { id } = jobManager.registerJobSchedule({
      type: 'agent.task',
      name: `heartbeat_${AGENT_ID}`,
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
    dbh.db
      .update(jobScheduleTable)
      .set({ metadata: { circuitBreakerPaused: true } })
      .where(eq(jobScheduleTable.id, id))
      .run()
    dbh.db.update(agentTable).set({ type: 'dsh' }).where(eq(agentTable.id, AGENT_ID)).run()

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('skipped-capability')
    const row = jobScheduleService.getById(id)
    expect(row?.enabled).toBe(false)
    expect(row?.metadata).toMatchObject({ circuitBreakerPaused: true })
  })

  it('resets a circuit-breaker pause through the heartbeat toggle off/on', async () => {
    // Toggling off clears the marker (the user's deliberate reset gesture);
    // toggling back on then converges to enabled as usual.
    seedAgent(AGENT_ID)
    const { id } = jobManager.registerJobSchedule({
      type: 'agent.task',
      name: `heartbeat_${AGENT_ID}`,
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
    dbh.db
      .update(jobScheduleTable)
      .set({ enabled: false, metadata: { circuitBreakerPaused: true } })
      .where(eq(jobScheduleTable.id, id))
      .run()

    setAgentConfiguration(AGENT_ID, { heartbeat_enabled: false })
    const offOutcome = await syncHeartbeatSchedule(AGENT_ID)
    expect(offOutcome).toBe('skipped-disabled')
    expect(jobScheduleService.getById(id)?.metadata).toMatchObject({ circuitBreakerPaused: false })

    setAgentConfiguration(AGENT_ID, { heartbeat_enabled: true })
    const onOutcome = await syncHeartbeatSchedule(AGENT_ID)
    expect(onOutcome).toBe('updated')
    expect(jobScheduleService.getById(id)?.enabled).toBe(true)
  })

  it('does not seed heartbeat.md when the workspace path is owned by a system row', async () => {
    // Ordering guard: findOrCreateByPath throws for a SYSTEM-owned path — the
    // file must not be provisioned first and orphaned (wedging future syncs).
    seedAgent(AGENT_ID)
    const workspacePath = path.join(agentsRoot, AGENT_ID)
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ name: 'legacy system workspace', path: workspacePath, type: 'system', orderKey: AGENT_ID })
      .run()
    try {
      await expect(syncHeartbeatSchedule(AGENT_ID)).rejects.toThrow()
      await expect(readFile(path.join(workspacePath, 'heartbeat.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      dbh.db.delete(agentWorkspaceTable).run()
    }
  })

  it('isolates a failing agent in the repair pass and provisions the rest', async () => {
    // AGENT_ID's data path is blocked by a regular file: its sync rejects, but
    // the allSettled pass must still provision the other agent.
    seedAgent(AGENT_ID)
    seedAgent(OTHER_AGENT_ID)
    rmSync(path.join(agentsRoot, AGENT_ID), { recursive: true, force: true })
    await writeFile(path.join(agentsRoot, AGENT_ID), 'not a directory')

    await repairHeartbeatSchedules()

    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
    expect(heartbeatRows(OTHER_AGENT_ID)).toHaveLength(1)
  })
  it('defers startup repair through nested backup holds and replays the latest configuration', async () => {
    seedAgent(AGENT_ID)
    const first = service.pause('backup')
    const second = service.pause('restore')
    vi.useFakeTimers()
    await service._doAllReady()
    await vi.advanceTimersByTimeAsync(60000)
    vi.useRealTimers()
    setAgentConfiguration(AGENT_ID, { heartbeat_interval: 45 })
    await service.syncHeartbeat(AGENT_ID)
    expect(await drainHeartbeatWork()).toBe(true)
    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
    first.dispose()
    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
    second.dispose()
    await drainHeartbeatWork()
    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
    expect(heartbeatRows(AGENT_ID)[0].trigger).toEqual({ kind: 'interval', ms: 45 * 60000 })
  })

  it('drains admitted IO but does not admit another agent while paused', async () => {
    seedAgent(AGENT_ID)
    seedAgent(OTHER_AGENT_ID)
    let release!: () => void
    heartbeatFileGate.current = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = service.syncHeartbeat(AGENT_ID)
    await vi.waitFor(() => expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1))
    const hold = service.pause('backup')
    await service.syncHeartbeat(OTHER_AGENT_ID)
    expect(await drainHeartbeatWork({ timeoutMs: 10 })).toBe(false)
    release()
    heartbeatFileGate.current = null
    await pending
    expect(await drainHeartbeatWork()).toBe(true)
    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
    expect(heartbeatRows(OTHER_AGENT_ID)).toHaveLength(0)
    hold.dispose()
    await drainHeartbeatWork()
    expect(heartbeatRows(OTHER_AGENT_ID)).toHaveLength(1)
  })

  it('joins creation-event provisioning without a duplicate file pass', async () => {
    seedAgent(AGENT_ID)
    const agent = agentService.getAgent(AGENT_ID)!
    const ensure = vi.spyOn(await import('../heartbeat'), 'ensureHeartbeatFile')
    agentService.emitAgentCreated(agent)
    await service.waitForHeartbeat(AGENT_ID)
    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
    expect(ensure).toHaveBeenCalledTimes(1)
    ensure.mockRestore()
  })

  it('recovers the SYSTEM template produced by the real workspace deletion cascade', async () => {
    seedAgent(AGENT_ID)
    await service.syncHeartbeat(AGENT_ID)
    const [row] = heartbeatRows(AGENT_ID)
    const oldWorkspace = (row.jobInputTemplate as AgentTaskInput).workspace
    if (oldWorkspace.type !== 'user') throw new Error('Expected user workspace')
    agentSessionService.deleteWorkspaceCascadeWithImpact(oldWorkspace.workspaceId)
    const input = jobScheduleService.getById(row.id)!.jobInputTemplate as AgentTaskInput
    expect(input.workspace).toEqual({ type: 'system' })
    const job = jobService.create({
      type: 'agent.task',
      status: 'running',
      queue: 'test',
      input,
      scheduleId: row.id,
      scheduledAt: Date.now()
    })
    await runAgentTask({ jobId: job.id, input } as JobContext<AgentTaskInput>)
    await drainHeartbeatWork()
    const repaired = jobScheduleService.getById(row.id)!
    expect(repaired.enabled).toBe(true)
    const workspace = (repaired.jobInputTemplate as AgentTaskInput).workspace
    expect(workspace.type).toBe('user')
    if (workspace.type !== 'user') throw new Error('Expected repaired user workspace')
    expect(workspace.workspaceId).not.toBe(oldWorkspace.workspaceId)
    expect(agentWorkspaceService.getById(workspace.workspaceId).path).toBe(path.join(agentsRoot, AGENT_ID))
    expect(scheduler.has(`schedule:${row.id}`)).toBe(true)
  })

  it('applies saved heartbeat configuration through the owner event', async () => {
    seedAgent(AGENT_ID)
    await service.syncHeartbeat(AGENT_ID)
    agentService.updateAgent(AGENT_ID, { configuration: { heartbeat_enabled: false } })
    await drainHeartbeatWork()
    expect(heartbeatRows(AGENT_ID)[0].enabled).toBe(false)
    agentService.updateAgent(AGENT_ID, { configuration: { heartbeat_enabled: true, heartbeat_interval: 45 } })
    await drainHeartbeatWork()
    expect(heartbeatRows(AGENT_ID)[0]).toMatchObject({ enabled: true, trigger: { kind: 'interval', ms: 2700000 } })
  })

  it('stops after admitted IO and compensates a new workspace without arming a schedule', async () => {
    seedAgent(AGENT_ID)
    let release!: () => void
    heartbeatFileGate.current = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = service.syncHeartbeat(AGENT_ID)
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1))
    const stopping = service._doStop()
    await service.syncHeartbeat(OTHER_AGENT_ID)
    release()
    heartbeatFileGate.current = null
    await rejected
    await stopping
    expect(heartbeatRows(AGENT_ID)).toHaveLength(0)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(0)
  })
})
