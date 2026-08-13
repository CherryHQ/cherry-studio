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
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DbService as DbServiceClass } from '../DbService'

const { notifyDataApiDataChange } = vi.hoisted(() => ({ notifyDataApiDataChange: vi.fn() }))

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange }))

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

const { DbService } = await vi.importActual<{ DbService: typeof DbServiceClass }>('../DbService')
type DbServiceInstance = InstanceType<typeof DbService>

function bareDbService(ready: boolean): DbServiceInstance {
  const tx = {}
  const service = Object.create(DbService.prototype) as DbServiceInstance
  Object.defineProperty(service, 'db', {
    value: { transaction: (fn: (value: object) => unknown) => fn(tx) }
  })
  Object.defineProperty(service, 'isReady', { value: ready })
  return service
}

describe('withWriteTx readiness guard — unit', () => {
  beforeEach(() => notifyDataApiDataChange.mockClear())

  it('rejects before init() without publishing', () => {
    const service = bareDbService(false)

    expect(() => service.withWriteTx(() => 'never')).toThrow(/not initialized/i)
    expect(notifyDataApiDataChange).not.toHaveBeenCalled()
  })

  it('publishes one deduplicated effect batch after commit', () => {
    const service = bareDbService(true)
    const effect: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'projection', entityIds: ['topic-1'] }

    expect(
      service.withWriteTx((tx) => {
        tx.effects.add(effect)
        tx.effects.add(effect)
        return 'ok'
      })
    ).toBe('ok')
    expect(notifyDataApiDataChange).toHaveBeenCalledExactlyOnceWith([effect])
  })

  it('publishes no effects when the write rolls back', () => {
    const service = bareDbService(true)

    expect(() =>
      service.withWriteTx((tx) => {
        tx.effects.add({ endpoint: '/topics', kind: 'membership', entityIds: ['topic-1'] })
        throw new Error('rollback')
      })
    ).toThrow('rollback')
    expect(notifyDataApiDataChange).not.toHaveBeenCalled()
  })

  it('merges nested transaction effects into the outer commit', () => {
    const service = bareDbService(true)

    service.withWriteTx((outer) => {
      outer.effects.add({ endpoint: '/topics', kind: 'projection', entityIds: ['topic-1'] })
      service.withWriteTx((inner) => {
        inner.effects.add({ endpoint: '/topics/latest' })
      })
    })

    expect(notifyDataApiDataChange).toHaveBeenCalledExactlyOnceWith([
      { endpoint: '/topics', kind: 'projection', entityIds: ['topic-1'] },
      { endpoint: '/topics/latest' }
    ])
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
