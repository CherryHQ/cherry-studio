/**
 * Tests for the heartbeat schedule sync lost in the JobManager migration
 * (#19203): `heartbeat_enabled` / `heartbeat_interval` must translate into a
 * real `agent.task` schedule the surviving run side can pick up.
 *
 * Runs against a real file-backed DB (production migrations) with a real
 * JobManager + SchedulerService, mirroring AgentJobsService.test.ts.
 */

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { eq } from 'drizzle-orm'
import { agentTaskService } from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { JobManager } from '@main/core/job/JobManager'
import type { JobHandler } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

// The sync only needs SOME registered handler for 'agent.task'.
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
  HEARTBEAT_PROMPT_SENTINEL,
  normalizeHeartbeatIntervalMinutes,
  syncHeartbeatSchedule
} from '../heartbeatSchedule'

const AGENT_ID = 'agent-hb-1'
const OTHER_AGENT_ID = 'agent-hb-2'

describe('heartbeatSchedule', () => {
  const dbh = setupTestDatabase()
  let scheduler: SchedulerService
  let jobManager: JobManager

  function seedAgent(id: string, configuration: Record<string, unknown> = {}): void {
    dbh.db
      .insert(agentTable)
      .values({
        id,
        type: 'claude-code',
        name: `Agent ${id}`,
        instructions: '',
        orderKey: id,
        configuration
      })
      .run()
  }

  function heartbeatScheduleOf(agentId: string) {
    return jobScheduleService.listAll({ type: 'agent.task' }).find((s) => {
      const t = s.jobInputTemplate as { agentId?: unknown; prompt?: unknown }
      return t?.agentId === agentId && t?.prompt === HEARTBEAT_PROMPT_SENTINEL
    })
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
    jobManager.registerHandler('agent.task', {
      recovery: 'retry',
      defaultConcurrency: 1,
      async execute() {
        return {}
      }
    })
  })

  beforeEach(() => {
    notifyDataApiDataChangeMock.mockClear()
    dbh.db.delete(agentTable).run()
  })

  afterAll(async () => {
    await jobManager._doStop()
    await scheduler._doStop()
    BaseService.resetInstances()
  })

  describe('normalizeHeartbeatIntervalMinutes', () => {
    it('falls back to the default for missing, zero, negative and non-finite values', () => {
      expect(normalizeHeartbeatIntervalMinutes(undefined)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
      expect(normalizeHeartbeatIntervalMinutes(0)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
      expect(normalizeHeartbeatIntervalMinutes(-5)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
      expect(normalizeHeartbeatIntervalMinutes(Number.NaN)).toBe(DEFAULT_HEARTBEAT_INTERVAL_MINUTES)
    })

    it('keeps valid intervals', () => {
      expect(normalizeHeartbeatIntervalMinutes(1)).toBe(1)
      expect(normalizeHeartbeatIntervalMinutes(45)).toBe(45)
    })
  })

  describe('syncHeartbeatSchedule', () => {
    it('creates a heartbeat schedule for an enabled agent (#19203)', () => {
      seedAgent(AGENT_ID, { heartbeat_enabled: true, heartbeat_interval: 5 })

      const result = syncHeartbeatSchedule(AGENT_ID)

      expect(result.status).toBe('created')
      const schedule = heartbeatScheduleOf(AGENT_ID)
      expect(schedule).toBeDefined()
      // 5 minutes -> interval trigger in ms
      expect(schedule?.trigger).toEqual({ kind: 'interval', ms: 5 * 60_000 })
      expect(schedule?.jobInputTemplate).toMatchObject({
        agentId: AGENT_ID,
        prompt: HEARTBEAT_PROMPT_SENTINEL
      })
      // the heartbeat must resolve heartbeat.md in a USER workspace
      const workspace = (schedule?.jobInputTemplate as { workspace?: { type?: string } }).workspace
      expect(workspace?.type).toBe('user')
      expect(notifyDataApiDataChangeMock).toHaveBeenCalled()
    })

    it('applies the default interval when none is configured', () => {
      seedAgent(AGENT_ID, { heartbeat_enabled: true })

      syncHeartbeatSchedule(AGENT_ID)

      expect(heartbeatScheduleOf(AGENT_ID)?.trigger).toEqual({
        kind: 'interval',
        ms: DEFAULT_HEARTBEAT_INTERVAL_MINUTES * 60_000
      })
    })

    it('updates the interval when the configuration changes and is a no-op otherwise', () => {
      seedAgent(AGENT_ID, { heartbeat_enabled: true, heartbeat_interval: 5 })
      syncHeartbeatSchedule(AGENT_ID)
      const first = heartbeatScheduleOf(AGENT_ID)

      notifyDataApiDataChangeMock.mockClear()
      expect(syncHeartbeatSchedule(AGENT_ID).status).toBe('unchanged')
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()

      dbh.db
        .update(agentTable)
        .set({ configuration: { heartbeat_enabled: true, heartbeat_interval: 10 } })
        .where(eq(agentTable.id, AGENT_ID))
        .run()

      expect(syncHeartbeatSchedule(AGENT_ID).status).toBe('updated')
      const second = heartbeatScheduleOf(AGENT_ID)
      expect(second?.id).toBe(first?.id)
      expect(second?.trigger).toEqual({ kind: 'interval', ms: 10 * 60_000 })
    })

    it('does nothing when the heartbeat is disabled', () => {
      seedAgent(AGENT_ID, { heartbeat_enabled: false, heartbeat_interval: 5 })

      expect(syncHeartbeatSchedule(AGENT_ID).status).toBe('disabled')
      expect(heartbeatScheduleOf(AGENT_ID)).toBeUndefined()
    })

    it('supports one heartbeat schedule per agent (schedule names are unique per type)', () => {
      seedAgent(AGENT_ID, { heartbeat_enabled: true, heartbeat_interval: 7 })
      seedAgent(OTHER_AGENT_ID, { heartbeat_enabled: true, heartbeat_interval: 9 })

      expect(syncHeartbeatSchedule(AGENT_ID).status).toBe('created')
      expect(syncHeartbeatSchedule(OTHER_AGENT_ID).status).toBe('created')

      const first = heartbeatScheduleOf(AGENT_ID)
      const second = heartbeatScheduleOf(OTHER_AGENT_ID)
      expect(first?.id).not.toBe(second?.id)
      expect(first?.name).not.toBe(second?.name)
      expect(first?.trigger).toEqual({ kind: 'interval', ms: 7 * 60_000 })
      expect(second?.trigger).toEqual({ kind: 'interval', ms: 9 * 60_000 })
    })

    it('reports agent-not-found for a missing agent', () => {
      expect(syncHeartbeatSchedule('no-such-agent').status).toBe('agent-not-found')
    })
  })

  describe('task listing integration', () => {
    it('excludes heartbeat schedules by default and includes them on request, keyed off the sentinel', () => {
      seedAgent(AGENT_ID, { heartbeat_enabled: true })
      syncHeartbeatSchedule(AGENT_ID)

      const visible = agentTaskService.listTasks(AGENT_ID)
      expect(visible.tasks.map((t) => t.name)).not.toContain(heartbeatScheduleOf(AGENT_ID)?.name)

      const withHeartbeat = agentTaskService.listTasks(AGENT_ID, { includeHeartbeat: true })
      expect(withHeartbeat.tasks.map((t) => t.name)).toContain(heartbeatScheduleOf(AGENT_ID)?.name)
    })
  })
})
