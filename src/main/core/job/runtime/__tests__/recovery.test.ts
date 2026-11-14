/**
 * Focused unit tests for `runStartupRecovery`'s in-flight exclusion contract.
 *
 * These pin the most regression-prone part of the fix for the startup-recovery
 * double-dispatch race (#16291): a job the CURRENT process is still executing
 * (reported via the `isOwnedByCurrentLaunch` predicate) must be left untouched by ALL
 * recovery branches — the exclusion sits at the TOP of the per-type loop, above
 * the cancelRequested override. The end-to-end JobManager integration test
 * proves the no-double-dispatch outcome; this proves the predicate filtering
 * directly, including the cancelRequested branch that the integration suite
 * (all live handlers are `retry`) cannot exercise.
 */

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { jobTable } from '@data/db/schemas/job'
import type { DbType } from '@data/db/types'
import { jobService } from '@data/services/JobService'
import { abandonLeftovers, runStartupRecovery } from '@main/core/job/runtime/recovery'
import type { JobHandler } from '@main/core/job/types'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

function handlersOf(type: string, recovery: 'abandon' | 'retry' | 'singleton'): ReadonlyMap<string, JobHandler> {
  return new Map<string, JobHandler>([
    [
      type,
      {
        recovery,
        async execute() {
          return null
        }
      }
    ]
  ])
}

describe('runStartupRecovery — in-flight exclusion', () => {
  setupTestDatabase()

  beforeEach(() => {
    const dbSvc = MockMainDbServiceExport.dbService
    ;(application.get as ReturnType<typeof vi.fn<(...args: any[]) => any>>).mockImplementation((name: string) => {
      if (name === 'DbService') return dbSvc
      throw new Error(`Unexpected application.get('${name}')`)
    })
  })

  it('keeps a row reported in-flight as running and resets the genuinely orphaned one', async () => {
    const type = 'task.retry.unit.inflight'
    const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
    const now = Date.now()
    const inserted = await dbh
      .insert(jobTable)
      .values([
        {
          type,
          status: 'running',
          queue: type,
          scheduledAt: now - 1000,
          startedAt: now - 800,
          attempt: 0,
          maxAttempts: 2,
          input: { marker: 'inflight' },
          cancelRequested: false,
          metadata: {}
        },
        {
          type,
          status: 'running',
          queue: type,
          scheduledAt: now - 1000,
          startedAt: now - 800,
          attempt: 0,
          maxAttempts: 2,
          input: { marker: 'orphan' },
          cancelRequested: false,
          metadata: {}
        }
      ])
      .returning()

    const inFlightId = inserted.find((r) => (r.input as { marker: string }).marker === 'inflight')!.id
    const orphanId = inserted.find((r) => (r.input as { marker: string }).marker === 'orphan')!.id

    runStartupRecovery(handlersOf(type, 'retry'), (id) => id === inFlightId)

    const inFlight = jobService.getById(inFlightId)
    const orphan = jobService.getById(orphanId)
    // The in-flight row is owned by this process — recovery must not touch it.
    expect(inFlight?.status).toBe('running')
    // The genuinely orphaned running row (prior-process leftover) is reset.
    expect(orphan?.status).toBe('pending')
  })

  it('does not cancel an in-flight row even when cancelRequested=true (filter sits above the cancelRequested branch)', async () => {
    const type = 'task.retry.unit.cancelreq'
    const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
    const now = Date.now()
    const [row] = await dbh
      .insert(jobTable)
      .values({
        type,
        status: 'running',
        queue: type,
        scheduledAt: now - 1000,
        startedAt: now - 800,
        attempt: 0,
        maxAttempts: 2,
        input: { marker: 'cr-inflight' },
        cancelRequested: true,
        metadata: {}
      })
      .returning()

    runStartupRecovery(handlersOf(type, 'retry'), (id) => id === row.id)

    const after = jobService.getById(row.id)
    // cancel() owns in-flight cancellation; recovery must leave this process's
    // live execution alone rather than racing a second terminal write.
    expect(after?.status).toBe('running')
  })

  // The filter sits at the top of the per-type loop precisely so it protects
  // EVERY strategy, not just `retry`: if it were ever moved into the retry
  // branch, singleton would cancel/reset the live row.
  it('singleton: leaves the in-flight row untouched and cancels the orphan it supersedes', async () => {
    const type = 'task.singleton.unit.inflight'
    const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
    const t0 = Date.now() - 5000
    const inserted = await dbh
      .insert(jobTable)
      .values([
        {
          type,
          status: 'running',
          queue: type,
          scheduledAt: t0,
          startedAt: t0 + 100,
          attempt: 0,
          maxAttempts: 1,
          input: { marker: 'inflight' },
          cancelRequested: false,
          metadata: {},
          createdAt: t0
        },
        {
          type,
          status: 'running',
          queue: type,
          scheduledAt: t0 + 1000,
          startedAt: t0 + 1100,
          attempt: 0,
          maxAttempts: 1,
          input: { marker: 'orphan' },
          cancelRequested: false,
          metadata: {},
          createdAt: t0 + 1000
        }
      ])
      .returning()

    const inFlightId = inserted.find((r) => (r.input as { marker: string }).marker === 'inflight')!.id
    const orphanId = inserted.find((r) => (r.input as { marker: string }).marker === 'orphan')!.id

    runStartupRecovery(handlersOf(type, 'singleton'), (id) => id === inFlightId)

    const inFlight = jobService.getById(inFlightId)
    const orphan = jobService.getById(orphanId)
    // In-flight is excluded from the keep/cancel partition entirely. Without the
    // filter, singleton keeps the newest (orphan) and CANCELS this older
    // in-flight row mid-flight.
    expect(inFlight?.status).toBe('running')
    // This process already runs the one instance, so keeping the orphan too would run two.
    expect(orphan?.status).toBe('cancelled')
  })
})

describe('startup recovery — per-job recovery', () => {
  setupTestDatabase()

  beforeEach(() => {
    const dbSvc = MockMainDbServiceExport.dbService
    ;(application.get as ReturnType<typeof vi.fn<(...args: any[]) => any>>).mockImplementation((name: string) => {
      if (name === 'DbService') return dbSvc
      throw new Error(`Unexpected application.get('${name}')`)
    })
  })

  it.each([
    { handlerRecovery: 'retry', jobRecovery: 'abandon', expected: { own: 'cancelled', handlers: 'pending' } },
    { handlerRecovery: 'abandon', jobRecovery: 'retry', expected: { own: 'pending', handlers: 'cancelled' } }
  ] as const)(
    'recovers a job enqueued with $jobRecovery that way, while its $handlerRecovery siblings follow the handler',
    async ({ handlerRecovery, jobRecovery, expected }) => {
      const type = `task.${handlerRecovery}.unit.override`
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
      const now = Date.now()
      const row = {
        type,
        status: 'running',
        queue: type,
        scheduledAt: now - 1000,
        startedAt: now - 800,
        attempt: 0,
        maxAttempts: 1,
        cancelRequested: false,
        metadata: {}
      }
      const [own, handlers] = await dbh
        .insert(jobTable)
        .values([
          { ...row, input: { marker: 'own' }, recovery: jobRecovery },
          { ...row, input: { marker: 'handlers' } }
        ])
        .returning()

      const handlerMap = handlersOf(type, handlerRecovery)
      abandonLeftovers(type, handlerMap.get(type)!, new Set([own.id, handlers.id]))
      runStartupRecovery(handlerMap, () => false)

      expect(jobService.getById(own.id)?.status).toBe(expected.own)
      expect(jobService.getById(handlers.id)?.status).toBe(expected.handlers)
    }
  )
})
