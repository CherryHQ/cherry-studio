import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DbService } from '../DbService'

// The main test setup replaces DbService with the unified mock. This suite exercises the
// production connection and close latch against a real temporary better-sqlite3 database.
vi.unmock('@main/data/db/DbService')

describe('DbService dev reset close', () => {
  let root: string
  let service: DbService | undefined

  beforeEach(async () => {
    BaseService.resetInstances()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'db-service-reset-'))
    const migrations = path.resolve('migrations/sqlite-drizzle')
    const providerRegistryData = path.resolve('packages/provider-registry/data')
    vi.mocked(application.getPath).mockImplementation(((key: string, filename?: string) => {
      const base =
        key === 'app.database.file'
          ? path.join(root, 'cherrystudio.sqlite')
          : key === 'app.database.migrations'
            ? migrations
            : key === 'feature.provider_registry.data'
              ? providerRegistryData
              : key === 'app.userdata'
                ? root
                : path.join(root, key)
      return filename ? path.join(base, filename) : base
    }) as typeof application.getPath)

    const { DbService } = await import('../DbService')
    service = new DbService()
    await service._doInit()
  })

  afterEach(() => {
    const raw = service as unknown as {
      sqlite?: { open: boolean; close: () => void }
      devResetCloseUncertain?: boolean
    }
    const sqlite = raw?.sqlite
    if (sqlite?.open && !raw.devResetCloseUncertain) {
      try {
        sqlite.close()
      } catch {
        // ignore teardown errors
      }
    }
    service = undefined
    BaseService.resetInstances()
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('proves the SQLite connection is closed and refuses to reopen it', () => {
    expect(service?.getDb()).toBeDefined()

    service?.closeForDevReset()

    expect((service as unknown as { sqlite: { open: boolean } }).sqlite.open).toBe(false)
    expect(() => service?.getDb()).toThrow('cannot reopen')
    expect(() => service?.withWriteTx(() => undefined)).toThrow('cannot reopen')

    expect(() => service?.closeForDevReset()).not.toThrow()
  })

  it('rejects getDb/withWriteTx when close proof is uncertain', () => {
    const sqlite = (service as unknown as { sqlite: { open: boolean; close: () => void } }).sqlite
    sqlite.close = () => {
      throw new Error('simulated close failure')
    }

    expect(() => service?.closeForDevReset()).toThrow('simulated close failure')
    expect(() => service?.getDb()).toThrow('uncertain')
    expect(() => service?.withWriteTx(() => undefined)).toThrow('uncertain')
    expect(() => service?.closeForDevReset()).toThrow('uncertain')
  })

  it('backupTo writes a readable copy on the managed connection', async () => {
    const dest = path.join(root, 'export-copy.sqlite')
    await service!.backupTo(dest)

    const Database = (await import('better-sqlite3')).default
    const copy = new Database(dest, { readonly: true })
    try {
      const ic = copy.pragma('integrity_check', { simple: true }) as string
      expect(ic).toBe('ok')
      // Seeded schema must be present (migrations + seeders ran in onInit).
      const tables = copy
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
        .all() as Array<{ name: string }>
      expect(tables.length).toBeGreaterThan(0)
    } finally {
      copy.close()
    }
  })

  it('backupTo refuses after closeForDevReset', async () => {
    service?.closeForDevReset()
    await expect(service!.backupTo(path.join(root, 'rejected.sqlite'))).rejects.toThrow(/cannot backupTo|cannot reopen/)
  })
})
