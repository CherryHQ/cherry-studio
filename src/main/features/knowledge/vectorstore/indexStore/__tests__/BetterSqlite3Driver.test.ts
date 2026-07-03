import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { BetterSqlite3Driver } from '../BetterSqlite3Driver'
import { openBetterSqlite3IndexDriver } from '../BetterSqlite3Driver'

describe('BetterSqlite3Driver', () => {
  let tempDir: string
  let driver: BetterSqlite3Driver

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-knowledge-driver-'))
    driver = openBetterSqlite3IndexDriver(join(tempDir, 'index.sqlite'))
    driver.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
  })

  afterEach(() => {
    driver.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('enables foreign keys on open', () => {
    const result = driver.execute('PRAGMA foreign_keys')
    expect(result.rows[0].foreign_keys).toBe(1)
  })

  it('opens in WAL journal mode with a busy timeout so reads survive a concurrent write', () => {
    const journal = driver.execute('PRAGMA journal_mode')
    expect(String(journal.rows[0].journal_mode).toLowerCase()).toBe('wal')

    const timeout = driver.execute('PRAGMA busy_timeout')
    expect(Number(timeout.rows[0].timeout)).toBeGreaterThan(0)
  })

  it('maps rows to plain objects', () => {
    driver.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'a'])

    const select = driver.execute('SELECT id, v FROM t WHERE id = ?', [1])
    expect(select.rows).toEqual([{ id: 1, v: 'a' }])
  })

  it('reports rows changed by a write statement', () => {
    driver.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'a'])
    driver.execute('INSERT INTO t (id, v) VALUES (?, ?)', [2, 'b'])

    const result = driver.execute('DELETE FROM t WHERE id = ?', [1])
    expect(result.changes).toBe(1)

    const select = driver.execute('SELECT id FROM t')
    expect(select.changes).toBe(0)
  })

  it('commits a successful transaction', () => {
    driver.transaction((tx) => {
      tx.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'x'])
      tx.execute('INSERT INTO t (id, v) VALUES (?, ?)', [2, 'y'])
    })

    const count = driver.execute('SELECT COUNT(*) AS n FROM t')
    expect(count.rows[0].n).toBe(2)
  })

  it('rolls back a failed transaction', () => {
    expect(() =>
      driver.transaction((tx) => {
        tx.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'x'])
        throw new Error('boom')
      })
    ).toThrow('boom')

    const count = driver.execute('SELECT COUNT(*) AS n FROM t')
    expect(count.rows[0].n).toBe(0)
  })

  it('throws if the transaction callback returns a promise, instead of silently committing early', () => {
    // better-sqlite3's native transaction() rejects an async callback outright (see
    // BetterSqlite3Driver.transaction doc) — an accidental async fn must fail loud
    // rather than commit before its awaited work actually ran.
    expect(() =>
      driver.transaction((tx) => {
        return Promise.resolve(tx.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'x']))
      })
    ).toThrow(/promise/i)

    const count = driver.execute('SELECT COUNT(*) AS n FROM t')
    expect(count.rows[0].n).toBe(0)
  })

  it('checkpoints but skips the VACUUM when the freed space is below the reclaim threshold', () => {
    // A small delete leaves a freelist far below the size/ratio thresholds, so reclaim
    // only truncates the WAL and reports that no whole-file rewrite ran.
    driver.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'a'])
    driver.execute('INSERT INTO t (id, v) VALUES (?, ?)', [2, 'b'])
    driver.execute('DELETE FROM t')

    const outcome = driver.reclaim()

    expect(outcome).toEqual({ vacuumed: false, reclaimedBytes: 0 })
  })

  it('reports closed state and rejects use after close with a deterministic error', () => {
    expect(driver.isClosed()).toBe(false)

    driver.close()

    expect(driver.isClosed()).toBe(true)
    expect(() => driver.execute('SELECT 1')).toThrow(/closed/)
    expect(() => driver.transaction((tx) => tx.execute('SELECT 1'))).toThrow(/closed/)
    // A second close (e.g. app shutdown after an explicit deleteStore) is a no-op.
    expect(driver.close()).toBeUndefined()
  })
})
