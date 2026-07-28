import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { publishArchive } from '../../archivePublish'
import { diskProbe } from '../../diskPreflight'
import { BackupCancelledError, InsufficientDiskSpaceError } from '../../errors'
import { hashStreamHooks } from '../../hashing'
import { admitArchive } from '../admitArchive'
import { extractStreamHooks } from '../extract'
import { buildExtendedMigrations, dbMeta, fakeDbMeta, liteManifest, snapshotDb, writeRawZip } from './helpers'

const migrationsFolder = resolveMigrationsPath()

describe('admitArchive', () => {
  const dbh = setupTestDatabase()
  let work: string
  let stagingParent: string

  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'bk-admit-'))
    stagingParent = path.join(work, 'staging')
    await mkdir(stagingParent, { recursive: true })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    hashStreamHooks.onChunk = () => {}
    extractStreamHooks.onChunk = () => {}
    await rm(work, { recursive: true, force: true })
  })

  async function snapshot(name = 'db.sqlite'): Promise<string> {
    const dbPath = path.join(work, name)
    snapshotDb(dbh.sqlite, dbPath)
    return dbPath
  }

  async function publish(dbPath: string, name = 'backup.cherrybackup'): Promise<string> {
    const outPath = path.join(work, name)
    await publishArchive({ outPath, manifest: liteManifest(await dbMeta(dbPath)), dbCopyPath: dbPath })
    return outPath
  }

  it('round-trips the producer two-file archive and returns an owned sealed database', async () => {
    const outPath = await publish(await snapshot())
    const admitted = await admitArchive({ archivePath: outPath, stagingParent, migrationsFolder })
    expect(admitted.manifest.preset).toBe('lite')
    expect(existsSync(admitted.db.path)).toBe(true)
    await admitted.cleanup()
    expect(existsSync(admitted.stagingDir)).toBe(false)
  })

  it('migrates a strict-prefix archive before returning its sealed DB', async () => {
    const extended = path.join(work, 'extended-migrations')
    buildExtendedMigrations(migrationsFolder, extended)
    const outPath = await publish(await snapshot())
    const admitted = await admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: extended })
    expect(admitted.migratedForward).toBe(true)
    await admitted.cleanup()
  })

  it.each([
    [
      'duplicate',
      [
        { name: 'manifest.json', data: Buffer.from('{}') },
        { name: 'manifest.json', data: Buffer.from('{}') }
      ]
    ],
    [
      'extra resource',
      [
        { name: 'manifest.json', data: Buffer.from('{}') },
        { name: 'backup.sqlite', data: Buffer.from('x') },
        { name: 'resources/x', data: Buffer.from('x') }
      ]
    ],
    [
      'path escape',
      [
        { name: 'manifest.json', data: Buffer.from('{}') },
        { name: 'backup.sqlite', data: Buffer.from('x') },
        { name: '../x', data: Buffer.from('x') }
      ]
    ]
  ])('rejects hostile %s input before leaving staging', async (_name, entries) => {
    const archivePath = path.join(work, 'hostile.cherrybackup')
    await writeRawZip(archivePath, entries)
    await expect(admitArchive({ archivePath, stagingParent, migrationsFolder })).rejects.toMatchObject({
      name: 'ArchiveAdmissionError'
    })
    await expect((await import('node:fs/promises')).readdir(stagingParent)).resolves.toEqual([])
  })

  it('rejects a DB hash mismatch before SQLite migration', async () => {
    const dbPath = await snapshot()
    const manifest = {
      ...liteManifest(await dbMeta(dbPath)),
      db: { hash: 'f'.repeat(64), sizeBytes: (await dbMeta(dbPath)).sizeBytes }
    }
    const archivePath = path.join(work, 'tampered.cherrybackup')
    await writeRawZip(archivePath, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
      { name: 'backup.sqlite', data: await readFile(dbPath) }
    ])
    await expect(admitArchive({ archivePath, stagingParent, migrationsFolder })).rejects.toMatchObject({
      reason: 'payload-mismatch'
    })
  })

  it('rejects an archive-supplied trigger before sanitation can update rows', async () => {
    const dbPath = await snapshot('trigger.sqlite')
    const sqlite = new Database(dbPath, { fileMustExist: true })
    try {
      sqlite.exec('CREATE TRIGGER hostile AFTER UPDATE ON mcp_server BEGIN SELECT 1; END')
    } finally {
      sqlite.close()
    }
    const archivePath = await publish(dbPath)
    await expect(admitArchive({ archivePath, stagingParent, migrationsFolder })).rejects.toMatchObject({
      reason: 'schema-mismatch'
    })
  })

  it('rejects corrupt databases after authenticating their archive bytes', async () => {
    const db = Buffer.from('not a sqlite database')
    const archivePath = path.join(work, 'corrupt.cherrybackup')
    await writeRawZip(archivePath, [
      {
        name: 'manifest.json',
        data: Buffer.from(
          JSON.stringify(liteManifest({ ...fakeDbMeta(), hash: await sha256(db), sizeBytes: db.length }))
        )
      },
      { name: 'backup.sqlite', data: db }
    ])
    await expect(admitArchive({ archivePath, stagingParent, migrationsFolder })).rejects.toMatchObject({
      reason: 'db-corrupt'
    })
  })

  it('cancels during actual-byte extraction and cleans its owned staging tree', async () => {
    const archivePath = await publish(await snapshot())
    const controller = new AbortController()
    extractStreamHooks.onChunk = (_bytes, entry) => {
      if (entry === 'backup.sqlite') controller.abort()
    }
    await expect(
      admitArchive({ archivePath, stagingParent, migrationsFolder, signal: controller.signal })
    ).rejects.toBeInstanceOf(BackupCancelledError)
    expect(await (await import('node:fs/promises')).readdir(stagingParent)).toEqual([])
  })

  it('does not create staging when its disk preflight fails', async () => {
    const archivePath = await publish(await snapshot())
    vi.spyOn(diskProbe, 'statfs').mockResolvedValue({ bavail: 0, bsize: 4096 } as never)
    await expect(admitArchive({ archivePath, stagingParent, migrationsFolder })).rejects.toBeInstanceOf(
      InsufficientDiskSpaceError
    )
    expect(await (await import('node:fs/promises')).readdir(stagingParent)).toEqual([])
  })
})

async function sha256(value: Buffer): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(value).digest('hex')
}
