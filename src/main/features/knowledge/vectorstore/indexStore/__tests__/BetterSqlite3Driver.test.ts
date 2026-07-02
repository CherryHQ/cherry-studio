import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BetterSqlite3Driver, openBetterSqlite3IndexDriver } from '../BetterSqlite3Driver'

const loggerWarnMock = vi.hoisted(() => vi.fn())

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ warn: loggerWarnMock })
  }
}))

describe('BetterSqlite3Driver', () => {
  let tempDir: string
  let driver: BetterSqlite3Driver

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-driver-'))
    driver = await openBetterSqlite3IndexDriver(join(tempDir, 'index.sqlite'))
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
    // A fake better-sqlite3 connection: the bracket's BEGIN IMMEDIATE succeeds, the
    // body's statement fails with originalError, then the ROLLBACK that the catch
    // issues fails with rollbackError. The driver must surface originalError (what the
    // caller needs to diagnose the write) and only log the rollback failure.
    const fakeDb = {
      prepare: () => {
        throw originalError
      },
      exec: (sql: string) => {
        if (sql === 'ROLLBACK') {
          throw rollbackError
        }
      },
      pragma: () => undefined,
      close: () => undefined
    } as unknown as Database.Database
    const isolatedDriver = new BetterSqlite3Driver(fakeDb)

    await expect(isolatedDriver.transaction(async (tx) => tx.execute('INSERT INTO t (id) VALUES (1)'))).rejects.toBe(
      originalError
    )
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Failed to roll back knowledge index store transaction after an error',
      rollbackError
    )
  })

  it('checkpoints but skips the VACUUM when the freed space is below the reclaim threshold', async () => {
    // A small delete leaves a freelist far below the size/ratio thresholds, so reclaim
    // only truncates the WAL and reports that no whole-file rewrite ran.
    await driver.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'a'])
    await driver.execute('INSERT INTO t (id, v) VALUES (?, ?)', [2, 'b'])
    await driver.execute('DELETE FROM t')

    const outcome = await driver.reclaim()

    expect(outcome).toEqual({ vacuumed: false, reclaimedBytes: 0 })
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
})
