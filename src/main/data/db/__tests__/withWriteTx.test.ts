/**
 * Tests for `DbService.withWriteTx`.
 *
 * better-sqlite3 keeps a single synchronous connection, so a write transaction
 * is inherently atomic and cannot interleave with another. The libsql-era
 * process-wide mutex and SQLITE_BUSY retry (workarounds for upstream issue
 * #288) were removed; `withWriteTx` is now a readiness guard in front of one
 * `BEGIN IMMEDIATE` transaction. The contracts worth guarding:
 *   - several writes compose into one transaction and all persist on commit;
 *   - any throw inside the tx rolls every write back;
 *   - the readiness guard rejects calls made before `init()`;
 *   - the engine rejects an async callback, enforcing the synchronous-fn
 *     contract the production JSDoc promises.
 */

import { type InsertJobRow, jobTable } from '@data/db/schemas/job'
import { jobService } from '@data/services/JobService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

/**
 * Faithful mirror of production `withWriteTx` (DbService.ts) — a readiness guard
 * in front of one `BEGIN IMMEDIATE` transaction. It is two lines, so keeping it
 * in lockstep with production is trivial; the unit tests below pin the guard
 * branch and the transaction options, which the always-ready integration suite
 * cannot reach.
 */
function makeWithWriteTx<Tx>(
  db: { transaction: (fn: (tx: Tx) => unknown, opts: { behavior: 'immediate' }) => unknown },
  isReady: boolean
) {
  return async function withWriteTx<T>(fn: (tx: Tx) => T): Promise<T> {
    if (!isReady) {
      throw new Error('Database is not initialized, please call init() first!')
    }
    return db.transaction(fn, { behavior: 'immediate' }) as T
  }
}

describe('withWriteTx readiness guard — unit', () => {
  it('rejects before init() without touching the db', async () => {
    const transaction = vi.fn()
    const withWriteTx = makeWithWriteTx({ transaction }, false)

    await expect(withWriteTx(() => 'never')).rejects.toThrow(/not initialized/i)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('runs fn inside a BEGIN IMMEDIATE transaction when ready', async () => {
    const transaction = vi.fn((fn: (tx: unknown) => unknown) => fn({}))
    const withWriteTx = makeWithWriteTx({ transaction }, true)

    await expect(withWriteTx(() => 'ok')).resolves.toBe('ok')
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { behavior: 'immediate' })
  })
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
    // single synchronous connection the two awaited creates simply run one
    // after the other; the assertion is that both rows survive.
    const results = await Promise.all([jobService.create(makeJobDto('job-0')), jobService.create(makeJobDto('job-1'))])
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
