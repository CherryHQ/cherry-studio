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

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { jobScheduleTable } from '@data/db/schemas/job'
import { agentService } from '@data/services/AgentService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { JobManager } from '@main/core/job/JobManager'
import type { JobHandler } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { DEFAULT_HEARTBEAT_INTERVAL_MINUTES } from '@shared/ai/agentHeartbeat'
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

import { repairHeartbeatSchedules, syncHeartbeatSchedule } from '../heartbeatSchedule'

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

  it('recreates a missing agent data directory and still seeds heartbeat.md', async () => {
    seedAgent(AGENT_ID)
    // Simulate a migrated/corrupted install: the row exists but the directory is gone.
    rmSync(path.join(agentsRoot, AGENT_ID), { recursive: true, force: true })

    const outcome = await syncHeartbeatSchedule(AGENT_ID)

    expect(outcome).toBe('created')
    const seeded = await readFile(path.join(agentsRoot, AGENT_ID, 'heartbeat.md'), 'utf-8')
    expect(seeded).toContain('<!--')
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

    const outcome = await syncHeartbeatSchedule(AGENT_ID, [])

    expect(outcome).toBe('updated')
    expect(heartbeatRows(AGENT_ID)).toHaveLength(1)
    // The winner was repaired to the canonical shape the sync would have written.
    expect(jobScheduleService.getById(id)?.jobInputTemplate).toMatchObject({
      workspace: { type: 'user' },
      reuseRevision: 0
    })
    expect(scheduler.has(`schedule:${id}`)).toBe(true)
  })

  it("does not treat a name-conflict winner as benign when it is not this agent's heartbeat row", async () => {
    // A non-heartbeat schedule that happens to share the reserved heartbeat
    // name (manual DB edit, legacy row, future feature) must not be silently
    // overwritten with the heartbeat template. The conflict is only benign when
    // the winner carries this agent's id + the sentinel prompt.
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

    await expect(syncHeartbeatSchedule(AGENT_ID, [])).rejects.toThrow()

    // The non-heartbeat row must be untouched: same id, same template, still enabled.
    const row = jobScheduleService.getById(id)
    expect(row?.jobInputTemplate).toEqual(templateBefore)
    expect(row?.enabled).toBe(true)
    expect(row?.trigger).toEqual({ kind: 'interval', ms: 5 * 60_000 })
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
    // fails on the UNIQUE conflict instead of overwriting the user's prompt.
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

    await expect(syncHeartbeatSchedule(AGENT_ID)).rejects.toThrow()

    const row = jobScheduleService.getById(id)
    expect(row?.jobInputTemplate).toEqual(templateBefore)
    expect(row?.enabled).toBe(true)
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
    // Two reads per sync (entry + post-commit deletion guard); the second
    // sync's reads must both come after the first sync fully settled.
    expect(events).toEqual(['read', 'read', 'first-settled', 'read', 'read'])
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
})
