import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Client } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LibsqlDriver, openLibsqlIndexDriver } from '../LibsqlDriver'

const loggerWarnMock = vi.hoisted(() => vi.fn())

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ warn: loggerWarnMock })
  }
}))

describe('LibsqlDriver', () => {
  let tempDir: string
  let driver: LibsqlDriver

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-driver-'))
    driver = await openLibsqlIndexDriver(join(tempDir, 'index.sqlite'))
    await driver.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
  })

  afterEach(async () => {
    await driver.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('enables foreign keys on open', async () => {
    const result = await driver.execute('PRAGMA foreign_keys')
    expect(result.rows[0].foreign_keys).toBe(1)
  })

  it('opens in WAL journal mode with a busy timeout so reads survive a concurrent write', async () => {
    const journal = await driver.execute('PRAGMA journal_mode')
    expect(String(journal.rows[0].journal_mode).toLowerCase()).toBe('wal')

    const timeout = await driver.execute('PRAGMA busy_timeout')
    expect(Number(timeout.rows[0].timeout)).toBeGreaterThan(0)
  })

  it('lets a read proceed while a write transaction is open instead of failing with SQLITE_BUSY', async () => {
    // Under the default rollback journal the open write would hold a lock and the
    // concurrent read would reject with SQLITE_BUSY. WAL lets the read see the last
    // committed state (the in-flight insert is uncommitted) without blocking.
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const write = driver.transaction(async (tx) => {
      await tx.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'x'])
      await held
    })

    const read = await driver.execute('SELECT COUNT(*) AS n FROM t')
    expect(read.rows[0].n).toBe(0)

    release()
    await write
    expect((await driver.execute('SELECT COUNT(*) AS n FROM t')).rows[0].n).toBe(1)
  })

  it('maps rows to plain objects', async () => {
    await driver.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'a'])

    const select = await driver.execute('SELECT id, v FROM t WHERE id = ?', [1])
    expect(select.rows).toEqual([{ id: 1, v: 'a' }])
  })

  it('commits a successful transaction', async () => {
    await driver.transaction(async (tx) => {
      await tx.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'x'])
      await tx.execute('INSERT INTO t (id, v) VALUES (?, ?)', [2, 'y'])
    })

    const count = await driver.execute('SELECT COUNT(*) AS n FROM t')
    expect(count.rows[0].n).toBe(2)
  })

  it('rolls back a failed transaction', async () => {
    await expect(
      driver.transaction(async (tx) => {
        await tx.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'x'])
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    const count = await driver.execute('SELECT COUNT(*) AS n FROM t')
    expect(count.rows[0].n).toBe(0)
  })

  it('rethrows the original error when rollback also fails, instead of masking it', async () => {
    const originalError = new Error('insert failed')
    const rollbackError = new Error('rollback failed')
    const fakeClient = {
      transaction: async () => ({
        execute: async () => {
          throw originalError
        },
        commit: async () => undefined,
        rollback: async () => {
          throw rollbackError
        }
      }),
      close: () => undefined
    } as unknown as Client
    const isolatedDriver = new LibsqlDriver(fakeClient)

    await expect(isolatedDriver.transaction(async (tx) => tx.execute('INSERT INTO t (id) VALUES (1)'))).rejects.toBe(
      originalError
    )
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Failed to roll back knowledge index store transaction after an error',
      rollbackError
    )
  })

  it('serializes concurrent write transactions instead of failing them with SQLITE_BUSY', async () => {
    // Without serialization, @libsql/client opens a fresh connection per
    // concurrent transaction('write') and all but the first BEGIN IMMEDIATE hit
    // SQLITE_BUSY (upstream #288). The write mutex must make them queue so every
    // one commits.
    const ids = Array.from({ length: 12 }, (_, i) => i + 1)
    const results = await Promise.allSettled(
      ids.map((id) => driver.transaction((tx) => tx.execute('INSERT INTO t (id, v) VALUES (?, ?)', [id, `v${id}`])))
    )

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    const count = await driver.execute('SELECT COUNT(*) AS n FROM t')
    expect(count.rows[0].n).toBe(ids.length)
  })

  it('serializes read-modify-write transactions so a contended counter reaches the exact total', async () => {
    // The mutex queues these so the final value is 10 only because no two overlap.
    // Without it, the concurrent BEGIN IMMEDIATE writes would instead reject with
    // SQLITE_BUSY (#288), so this fails on regression too — by rejection here.
    await driver.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, '0'])
    const increments = Array.from({ length: 10 }, () =>
      driver.transaction(async (tx) => {
        const current = await tx.execute('SELECT v FROM t WHERE id = 1')
        const next = Number((current.rows[0].v as string) ?? '0') + 1
        await tx.execute('UPDATE t SET v = ? WHERE id = 1', [String(next)])
      })
    )
    await Promise.all(increments)

    const final = await driver.execute('SELECT v FROM t WHERE id = 1')
    expect(Number(final.rows[0].v)).toBe(10)
  })

  it('reports closed state and rejects use after close with a deterministic error', async () => {
    expect(driver.isClosed()).toBe(false)

    await driver.close()

    expect(driver.isClosed()).toBe(true)
    await expect(driver.execute('SELECT 1')).rejects.toThrow(/closed/)
    await expect(driver.transaction(async (tx) => tx.execute('SELECT 1'))).rejects.toThrow(/closed/)
    // A second close (e.g. app shutdown after an explicit deleteStore) is a no-op.
    await expect(driver.close()).resolves.toBeUndefined()
  })

  it('rejects a queued transaction with the deterministic closed error when close lands while it waits', async () => {
    // Pins the post-acquire assertOpen re-check: B passes the entry check while A
    // holds the mutex, the driver closes, then B acquires — without the re-check B
    // would BEGIN on the closed client and fail with an opaque libsql error.
    let releaseFirst: () => void = () => undefined
    const firstHolds = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstEntered: () => void = () => undefined
    const firstStarted = new Promise<void>((resolve) => {
      firstEntered = resolve
    })

    const first = driver.transaction(async (tx) => {
      await tx.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'x'])
      firstEntered()
      await firstHolds
    })
    await firstStarted

    const queued = driver.transaction(async (tx) => tx.execute('SELECT 1'))
    queued.catch(() => undefined) // assertion awaits it below; avoid an unhandled rejection in between

    await driver.close()
    releaseFirst()

    await expect(queued).rejects.toThrow('Knowledge index store driver is closed')
    // Whether the in-flight transaction's commit still lands after close() is
    // libsql-internal, not contractual — just let it settle either way.
    await first.catch(() => undefined)
  })
})
