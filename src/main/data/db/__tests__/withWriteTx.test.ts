/**
 * Real SQLite coverage for atomic writes, rollback, and rejection of asynchronous transactions.
 */

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { type InsertJobRow, jobTable } from '@data/db/schemas/job'
import { jobService } from '@data/services/JobService'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

describe('withWriteTx integration — real better-sqlite3', () => {
  const dbh = setupTestDatabase()

  const makeJobDto = (id: string): InsertJobRow => ({
    id,
    type: 'integration.test',
    queue: 'integration.test',
    status: 'pending',
    scheduledAt: Date.now(),
    attempt: 0,
    maxAttempts: 1,
    input: { id },
    cancelRequested: false,
    metadata: {}
  })

  it('commits writes — two jobs created through withWriteTx both persist', async () => {
    // `jobService.create` is a thin wrapper over `DbService.withWriteTx`. On a
    // single synchronous connection the two creates simply run one after the
    // other; the assertion is that both rows survive.
    const results = [jobService.create(makeJobDto('job-0')), jobService.create(makeJobDto('job-1'))]
    expect(results.map((r) => r.id).sort()).toEqual(['job-0', 'job-1'])

    const rows = await dbh.db.select().from(jobTable)
    expect(rows.map((r) => r.id).sort()).toEqual(['job-0', 'job-1'])
  })

  it('rolls every write back when the tx fn throws', async () => {
    const boom = new Error('boom')
    expect(() =>
      dbh.db.transaction(
        (tx) => {
          tx.insert(jobTable).values(makeJobDto('rollback-job')).run()
          throw boom
        },
        { behavior: 'immediate' }
      )
    ).toThrow(boom)

    const rows = await dbh.db.select().from(jobTable).where(eq(jobTable.id, 'rollback-job'))
    expect(rows).toHaveLength(0)
  })

  it('rejects an async tx fn — enforces the synchronous-fn contract', () => {
    // Production types `fn` as synchronous; this proves the engine-level guard
    // that backs that type: better-sqlite3 throws if the callback returns a
    // promise, so a stray `await` inside a write tx fails loudly instead of
    // committing early.
    expect(() => dbh.db.transaction(async () => 'nope', { behavior: 'immediate' })).toThrow(/cannot return a promise/i)
  })
})
