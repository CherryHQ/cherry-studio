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

  it('maps rows to plain objects and reports rowsAffected', async () => {
    const insert = await driver.execute('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'a'])
    expect(insert.rowsAffected).toBe(1)

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
