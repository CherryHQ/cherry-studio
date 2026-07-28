import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BackupCancelledError } from '../../errors'
import { hashStreamHooks } from '../../hashing'
import { admitStagedDatabase, classifyChain } from '../chain'
import {
  buildExtendedMigrations,
  buildForkedMigrations,
  buildMigratedDb,
  buildTruncatedMigrations,
  dbMeta,
  fakeDbMeta,
  liteManifest,
  setJournalModeWal,
  snapshotDb
} from './helpers'

describe('classifyChain', () => {
  const A = { folderMillis: 1, hash: 'a' }
  const B = { folderMillis: 2, hash: 'b' }
  const C = { folderMillis: 3, hash: 'c' }
  const Bprime = { folderMillis: 2, hash: 'b-prime' }

  it('reports exact when the chains are identical', () => {
    expect(classifyChain([A, B], [A, B])).toEqual({ kind: 'exact' })
  })
  it('reports prefix and the exact migrate-forward distance', () => {
    expect(classifyChain([A], [A, B])).toEqual({ kind: 'prefix', missingOnSource: 1 })
  })
  it('reports an ahead source and its first extra migration', () => {
    expect(classifyChain([A, B, C], [A, B])).toEqual({
      kind: 'ahead',
      extraOnSource: 1,
      firstExtraIndex: 3
    })
  })
  it('reports a fork at a one-based migration index', () => {
    expect(classifyChain([A, Bprime], [A, B])).toEqual({ kind: 'fork', firstDivergentIndex: 2 })
  })
})

describe('admitStagedDatabase', () => {
  const dbh = setupTestDatabase()
  const realFolder = resolveMigrationsPath()
  const fullLen = readMigrationFiles({ migrationsFolder: realFolder }).length

  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bk-chain-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    hashStreamHooks.onChunk = () => {}
  })

  function noSidecars(dbPath: string): boolean {
    return !existsSync(`${dbPath}-wal`) && !existsSync(`${dbPath}-shm`)
  }

  it('accepts an exact-chain DB and does not migrate', async () => {
    const dbPath = path.join(dir, 'backup.sqlite')
    snapshotDb(dbh.sqlite, dbPath)
    const meta = await dbMeta(dbPath)
    const res = await admitStagedDatabase(dbPath, liteManifest(meta), realFolder, undefined)
    expect(res.migratedForward).toBe(false)
    expect(res.finalChain.length).toBe(fullLen)
    expect(res.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(noSidecars(dbPath)).toBe(true)
  })

  it('migrates a strict-prefix (older-chain) DB forward and re-proves integrity', async () => {
    const extended = path.join(dir, 'm-extended')
    buildExtendedMigrations(realFolder, extended)
    const dbPath = path.join(dir, 'old.sqlite')
    snapshotDb(dbh.sqlite, dbPath)
    const meta = await dbMeta(dbPath)
    expect(meta.chain.length).toBe(fullLen)

    const res = await admitStagedDatabase(dbPath, liteManifest(meta), extended, undefined)
    expect(res.migratedForward).toBe(true)
    expect(res.finalChain.length).toBe(fullLen + 1)
    expect(res.hash).not.toBe(meta.hash) // migrate-forward rewrote the file
    expect(res.sizeBytes).toBeGreaterThan(0)
    expect(noSidecars(dbPath)).toBe(true)
  })

  it('folds migrated rows into the main file for a WAL-mode older-chain DB (no sidecars remain)', async () => {
    const extended = path.join(dir, 'm-extended')
    buildExtendedMigrations(realFolder, extended)
    const dbPath = path.join(dir, 'wal-old.sqlite')
    snapshotDb(dbh.sqlite, dbPath)
    setJournalModeWal(dbPath) // persist WAL mode → migrate-forward writes through -wal
    const meta = await dbMeta(dbPath)

    const res = await admitStagedDatabase(dbPath, liteManifest(meta), extended, undefined)
    expect(res.migratedForward).toBe(true)
    expect(noSidecars(dbPath)).toBe(true)
    // A fresh readonly reader (no -wal present) sees the full migrated chain, so
    // the migrated rows are provably in the sealed main file, not a sidecar.
    const after = await dbMeta(dbPath)
    expect(after.chain.length).toBe(fullLen + 1)
  })

  it('rejects an archive-supplied trigger even when its migration chain matches', async () => {
    const dbPath = path.join(dir, 'trigger.sqlite')
    snapshotDb(dbh.sqlite, dbPath)
    const sqlite = new Database(dbPath, { fileMustExist: true })
    try {
      sqlite.exec(`
        CREATE TRIGGER rearm_mcp_server
        AFTER UPDATE OF is_active ON mcp_server
        BEGIN
          UPDATE mcp_server SET is_active = 1 WHERE id = NEW.id;
        END
      `)
    } finally {
      sqlite.close()
    }
    const meta = await dbMeta(dbPath)

    await expect(admitStagedDatabase(dbPath, liteManifest(meta), realFolder, undefined)).rejects.toMatchObject({
      reason: 'schema-mismatch'
    })
  })

  it('rejects a DB ahead of the bundled chain', async () => {
    const dbPath = path.join(dir, 'ahead.sqlite')
    snapshotDb(dbh.sqlite, dbPath)
    const meta = await dbMeta(dbPath)
    const shortFolder = path.join(dir, 'm-short')
    buildTruncatedMigrations(realFolder, shortFolder, fullLen - 1)
    await expect(admitStagedDatabase(dbPath, liteManifest(meta), shortFolder, undefined)).rejects.toMatchObject({
      reason: 'chain-incompatible'
    })
  })

  it('rejects a DB forked from the bundled chain', async () => {
    const forked = path.join(dir, 'm-fork')
    buildForkedMigrations(realFolder, forked, 0)
    const dbPath = path.join(dir, 'fork.sqlite')
    buildMigratedDb(dbPath, forked)
    const meta = await dbMeta(dbPath)
    await expect(admitStagedDatabase(dbPath, liteManifest(meta), realFolder, undefined)).rejects.toMatchObject({
      reason: 'chain-incompatible'
    })
  })

  it('rejects when the staged applied chain != the manifest chain', async () => {
    const dbPath = path.join(dir, 'backup.sqlite')
    snapshotDb(dbh.sqlite, dbPath)
    const meta = await dbMeta(dbPath)
    const manifest = liteManifest(meta)
    manifest.migrationChain = manifest.migrationChain.slice(0, -1) // drops the tip → differs from actual
    await expect(admitStagedDatabase(dbPath, manifest, realFolder, undefined)).rejects.toMatchObject({
      reason: 'chain-mismatch'
    })
  })

  it('rejects a corrupt / non-database file', async () => {
    const dbPath = path.join(dir, 'corrupt.sqlite')
    await writeFile(dbPath, Buffer.from('this is definitely not a sqlite database'))
    await expect(admitStagedDatabase(dbPath, liteManifest(fakeDbMeta()), realFolder, undefined)).rejects.toMatchObject({
      reason: 'db-corrupt'
    })
  })

  it('honors a pre-aborted signal before opening the DB', async () => {
    const dbPath = path.join(dir, 'backup.sqlite')
    snapshotDb(dbh.sqlite, dbPath)
    const meta = await dbMeta(dbPath)
    const ac = new AbortController()
    ac.abort()
    await expect(admitStagedDatabase(dbPath, liteManifest(meta), realFolder, ac.signal)).rejects.toBeInstanceOf(
      BackupCancelledError
    )
  })

  it('cancels during the post-migration final hash', async () => {
    const extended = path.join(dir, 'm-extended')
    buildExtendedMigrations(realFolder, extended)
    const dbPath = path.join(dir, 'old.sqlite')
    snapshotDb(dbh.sqlite, dbPath)
    const meta = await dbMeta(dbPath)
    const ac = new AbortController()
    // The only cancellable hash in admitStagedDatabase is the final seal hash,
    // which runs after migrate-forward — aborting on its first chunk proves
    // post-migration cancellation.
    hashStreamHooks.onChunk = () => ac.abort()
    await expect(admitStagedDatabase(dbPath, liteManifest(meta), extended, ac.signal)).rejects.toBeInstanceOf(
      BackupCancelledError
    )
  })
})
