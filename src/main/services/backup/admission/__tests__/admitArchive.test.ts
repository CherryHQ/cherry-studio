import { existsSync } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { publishArchive } from '../../archivePublish'
import { diskProbe } from '../../diskPreflight'
import { BackupCancelledError, InsufficientDiskSpaceError } from '../../errors'
import { hashDirectoryUnit, hashStreamHooks, sha256File } from '../../hashing'
import type { BackupManifest, ResourcePayload } from '../../manifest'
import { admitArchive } from '../admitArchive'
import { extractStreamHooks } from '../extract'
import {
  buildMigratedDb,
  buildTruncatedMigrations,
  dbMeta,
  fakeDbMeta,
  fullManifest,
  liteManifest,
  snapshotDb,
  writeRawZip
} from './helpers'

const realFolder = resolveMigrationsPath()
const fullLen = readMigrationFiles({ migrationsFolder: realFolder }).length

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

  async function snapshotDbAt(name = 'db.sqlite'): Promise<string> {
    const dbPath = path.join(work, name)
    snapshotDb(dbh.sqlite, dbPath)
    return dbPath
  }

  async function buildResources(): Promise<{ dir: string; payloads: ResourcePayload[] }> {
    const dir = path.join(work, 'res')
    const blobPath = path.join(dir, 'Data', 'Files', 'blob.bin')
    const kbPath = path.join(dir, 'Data', 'KnowledgeBase', 'kb')
    await mkdir(path.join(kbPath, 'sub'), { recursive: true })
    await mkdir(path.dirname(blobPath), { recursive: true })
    await writeFile(blobPath, 'BLOB-CONTENT')
    await writeFile(path.join(kbPath, 'a.txt'), 'A')
    await writeFile(path.join(kbPath, 'sub', 'b.txt'), 'BB')

    const blobHash = await sha256File(blobPath)
    const blobSize = (await stat(blobPath)).size
    const kb = await hashDirectoryUnit(kbPath)
    const kbSize = kb.files.reduce((sum, f) => sum + f.size, 0)

    return {
      dir,
      payloads: [
        {
          kind: 'file-blob',
          resourceType: 'file',
          archivePath: 'resources/Data/Files/blob.bin',
          livePath: 'Data/Files/blob.bin',
          hash: blobHash,
          sizeBytes: blobSize,
          executable: false
        },
        {
          kind: 'knowledge',
          resourceType: 'directory',
          archivePath: 'resources/Data/KnowledgeBase/kb',
          livePath: 'Data/KnowledgeBase/kb',
          hash: kb.hash,
          sizeBytes: kbSize
        }
      ]
    }
  }

  async function siblingSurvives(): Promise<() => Promise<void>> {
    const sibling = path.join(stagingParent, 'pre-existing')
    await mkdir(sibling)
    await writeFile(path.join(sibling, 'keep.txt'), 'KEEP')
    return async () => {
      expect(await readFile(path.join(sibling, 'keep.txt'), 'utf8')).toBe('KEEP')
      const left = (await readdir(stagingParent)).filter((n) => n.startsWith('cs-admit-'))
      expect(left).toEqual([])
    }
  }

  it('round-trips a valid Lite archive (producer → admission)', async () => {
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const outPath = path.join(work, 'lite.cherrybackup')
    await publishArchive({ outPath, manifest: liteManifest(meta), dbCopyPath: dbPath })

    const admitted = await admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    expect(admitted.manifest.preset).toBe('lite')
    expect(admitted.resources).toEqual([])
    expect(admitted.migratedForward).toBe(false)
    expect(await sha256File(admitted.db.path)).toBe(admitted.db.hash)
    expect(admitted.finalChain.length).toBe(fullLen)
    expect(existsSync(admitted.db.path)).toBe(true)

    await admitted.cleanup()
    expect(existsSync(admitted.stagingDir)).toBe(false)
    await admitted.cleanup() // idempotent
  })

  it('round-trips a valid Full archive with file + directory units', async () => {
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const { dir, payloads } = await buildResources()
    const outPath = path.join(work, 'full.cherrybackup')
    await publishArchive({ outPath, manifest: fullManifest(meta, payloads), dbCopyPath: dbPath, resourcesDir: dir })

    const admitted = await admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    expect(admitted.manifest.preset).toBe('full')
    expect(admitted.resources.map((r) => r.kind).sort()).toEqual(['file-blob', 'knowledge'])
    for (const r of admitted.resources) {
      expect(existsSync(r.stagedPath)).toBe(true)
      expect(r.stagedPath.startsWith(admitted.stagingDir)).toBe(true)
    }
    await admitted.cleanup()
  })

  it('round-trips the executable bit without restoring broader permissions', async () => {
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const { dir, payloads } = await buildResources()
    const blobPath = path.join(dir, 'Data', 'Files', 'blob.bin')
    await chmod(blobPath, 0o755)
    const executablePayloads = payloads.map((payload) =>
      payload.resourceType === 'file' ? { ...payload, executable: true } : payload
    )
    const outPath = path.join(work, 'executable.cherrybackup')
    await publishArchive({
      outPath,
      manifest: fullManifest(meta, executablePayloads),
      dbCopyPath: dbPath,
      resourcesDir: dir
    })

    const admitted = await admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    const file = admitted.resources.find((resource) => resource.resourceType === 'file')
    expect(file).toBeDefined()
    expect((await stat(file!.stagedPath)).mode & 0o777).toBe(0o700)
    await admitted.cleanup()
  })

  it('migrates a valid older-chain (strict-prefix) archive forward', async () => {
    const truncated = path.join(work, 'm-trunc')
    buildTruncatedMigrations(realFolder, truncated, fullLen - 1)
    const oldPath = path.join(work, 'old.sqlite')
    buildMigratedDb(oldPath, truncated)
    const meta = await dbMeta(oldPath)
    const outPath = path.join(work, 'old.cherrybackup')
    await publishArchive({ outPath, manifest: liteManifest(meta), dbCopyPath: oldPath })

    const admitted = await admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    expect(admitted.migratedForward).toBe(true)
    expect(admitted.finalChain.length).toBe(fullLen)
    expect(admitted.db.hash).not.toBe(meta.hash)
    await admitted.cleanup()
  })

  it('diagnoses an ahead chain and removes its owned staging tree', async () => {
    const assertSibling = await siblingSurvives()
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const outPath = path.join(work, 'ahead.cherrybackup')
    await publishArchive({ outPath, manifest: liteManifest(meta), dbCopyPath: dbPath })
    const truncated = path.join(work, 'm-target')
    buildTruncatedMigrations(realFolder, truncated, fullLen - 2)

    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: truncated })
    ).rejects.toMatchObject({
      name: 'BackupMigrationCompatibilityError',
      diagnostic: {
        kind: 'source-ahead',
        missingMigrationCount: 2,
        sourceMigrationCount: fullLen,
        targetMigrationCount: fullLen - 2
      }
    })
    await assertSibling()
  })

  it('rejects a DB payload hash tamper before any migration', async () => {
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const tampered: BackupManifest = { ...liteManifest(meta), db: { hash: 'f'.repeat(64), sizeBytes: meta.sizeBytes } }
    const outPath = path.join(work, 'tamper.cherrybackup')
    await writeRawZip(outPath, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(tampered)) },
      { name: 'backup.sqlite', data: await readFile(dbPath) }
    ])
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toMatchObject({
      reason: 'payload-mismatch'
    })
  })

  it('rejects a resource payload hash tamper', async () => {
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const { dir, payloads } = await buildResources()
    const tampered = payloads.map((p) => (p.kind === 'file-blob' ? { ...p, hash: 'a'.repeat(64) } : p))
    const outPath = path.join(work, 'rtamper.cherrybackup')
    await writeRawZip(outPath, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(fullManifest(meta, tampered))) },
      { name: 'backup.sqlite', data: await readFile(dbPath) },
      { name: 'resources/Data/Files/blob.bin', data: await readFile(path.join(dir, 'Data', 'Files', 'blob.bin')) },
      {
        name: 'resources/Data/KnowledgeBase/kb/a.txt',
        data: await readFile(path.join(dir, 'Data', 'KnowledgeBase', 'kb', 'a.txt'))
      },
      {
        name: 'resources/Data/KnowledgeBase/kb/sub/b.txt',
        data: await readFile(path.join(dir, 'Data', 'KnowledgeBase', 'kb', 'sub', 'b.txt'))
      }
    ])
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toMatchObject({
      reason: 'payload-mismatch'
    })
  })

  it('rejects malformed manifest JSON', async () => {
    const dbPath = await snapshotDbAt()
    const outPath = path.join(work, 'badjson.cherrybackup')
    await writeRawZip(outPath, [
      { name: 'manifest.json', data: Buffer.from('{ not json') },
      { name: 'backup.sqlite', data: await readFile(dbPath) }
    ])
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toMatchObject({
      reason: 'manifest-invalid'
    })
  })

  it('diagnoses an unsupported format from only its bounded envelope and cleans staging', async () => {
    const assertSibling = await siblingSurvives()
    const dbPath = await snapshotDbAt()
    const manifest = {
      ...(await dbMeta(dbPath)),
      backupFormatVersion: 3,
      producer: {
        appVersion: '2.1.0',
        buildType: 'packaged',
        path: '/private/archive-controlled'
      },
      payload: { path: '/private/archive-controlled' }
    }
    const outPath = path.join(work, 'future.cherrybackup')
    await writeRawZip(outPath, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
      { name: 'backup.sqlite', data: await readFile(dbPath) }
    ])

    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toMatchObject({
      name: 'BackupFormatCompatibilityError',
      archiveFormatVersion: 3,
      archiveAppVersion: '2.1.0',
      archiveBuildType: 'packaged'
    })
    await assertSibling()
  })

  it('rejects a schema-invalid manifest', async () => {
    const dbPath = await snapshotDbAt()
    const outPath = path.join(work, 'badschema.cherrybackup')
    await writeRawZip(outPath, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify({ backupFormatVersion: 2 })) },
      { name: 'backup.sqlite', data: await readFile(dbPath) }
    ])
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toMatchObject({
      reason: 'manifest-invalid'
    })
  })

  it('rejects an archive-supplied capability trigger through the full pipeline', async () => {
    const dbPath = await snapshotDbAt('trigger.sqlite')
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
    const outPath = path.join(work, 'trigger.cherrybackup')
    await publishArchive({ outPath, manifest: liteManifest(meta), dbCopyPath: dbPath })

    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toMatchObject({
      reason: 'schema-mismatch'
    })
  })

  it('rejects a corrupt database through the full pipeline', async () => {
    const garbage = Buffer.from('not a sqlite database, just bytes')
    const meta = {
      hash: await sha256Buffer(garbage),
      sizeBytes: garbage.length,
      chain: [{ folderMillis: 1, hash: 'x' }]
    }
    const outPath = path.join(work, 'corrupt.cherrybackup')
    await writeRawZip(outPath, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(liteManifest(meta))) },
      { name: 'backup.sqlite', data: garbage }
    ])
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toMatchObject({
      reason: 'db-corrupt'
    })
  })

  it('honors a pre-aborted signal and creates no staging', async () => {
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const outPath = path.join(work, 'cancel.cherrybackup')
    await publishArchive({ outPath, manifest: liteManifest(meta), dbCopyPath: dbPath })
    const ac = new AbortController()
    ac.abort()
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder, signal: ac.signal })
    ).rejects.toBeInstanceOf(BackupCancelledError)
    expect((await readdir(stagingParent)).filter((n) => n.startsWith('cs-admit-'))).toEqual([])
  })

  it('leaves a pre-existing staging sibling untouched and no residue when admission fails after staging', async () => {
    const assertSurvives = await siblingSurvives()
    const garbage = Buffer.from('corrupt-db-bytes')
    const meta = {
      hash: await sha256Buffer(garbage),
      sizeBytes: garbage.length,
      chain: [{ folderMillis: 1, hash: 'x' }]
    }
    const outPath = path.join(work, 'fail.cherrybackup')
    await writeRawZip(outPath, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(liteManifest(meta))) },
      { name: 'backup.sqlite', data: garbage }
    ])
    await expect(admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })).rejects.toThrow()
    await assertSurvives()
  })

  it('fails a path-escape archive before any staging is created', async () => {
    const assertSurvives = await siblingSurvives()
    const dbPath = await snapshotDbAt()
    const outPath = path.join(work, 'escape.cherrybackup')
    await writeRawZip(outPath, [
      { name: 'manifest.json', data: Buffer.from('{}') },
      { name: 'backup.sqlite', data: await readFile(dbPath) },
      { name: '../evil', data: Buffer.from('x') }
    ])
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toMatchObject({
      reason: 'entry-name'
    })
    await assertSurvives()
  })

  it('rejects a DB whose actual bytes fall short of its declared central size (forged-small)', async () => {
    const outPath = path.join(work, 'forged-small.cherrybackup')
    await writeRawZip(outPath, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(liteManifest(fakeDbMeta()))) },
      {
        name: 'backup.sqlite',
        data: Buffer.from('shortdb'),
        centralUncompressedSize: 5000,
        centralCompressedSize: 5000
      }
    ])
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toMatchObject({ reason: 'entry-size-mismatch' })
    expect((await readdir(stagingParent)).filter((n) => n.startsWith('cs-admit-'))).toEqual([])
  })

  it('rejects a DB whose actual bytes exceed its declared central size (forged-large)', async () => {
    const outPath = path.join(work, 'forged-large.cherrybackup')
    await writeRawZip(outPath, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(liteManifest(fakeDbMeta()))) },
      {
        name: 'backup.sqlite',
        data: Buffer.from('this is longer than declared'),
        centralUncompressedSize: 3,
        centralCompressedSize: 30
      }
    ])
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toMatchObject({ reason: 'entry-size-mismatch' })
  })

  it('bounds a manifest that streams past its declared size before parsing', async () => {
    const bigManifest = Buffer.from(JSON.stringify(liteManifest(fakeDbMeta())))
    expect(bigManifest.length).toBeGreaterThan(10)
    const outPath = path.join(work, 'manifest-cap.cherrybackup')
    await writeRawZip(outPath, [
      { name: 'manifest.json', data: bigManifest, centralUncompressedSize: 5, centralCompressedSize: 5 },
      { name: 'backup.sqlite', data: Buffer.from('db') }
    ])
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toMatchObject({ reason: 'entry-size-mismatch' })
  })

  it('rejects a Full directory unit whose staged node is a regular file (type mismatch)', async () => {
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const payloads: ResourcePayload[] = [
      {
        kind: 'knowledge',
        resourceType: 'directory',
        archivePath: 'resources/Data/KnowledgeBase/kb',
        livePath: 'Data/KnowledgeBase/kb',
        hash: '0'.repeat(64),
        sizeBytes: 1
      }
    ]
    const outPath = path.join(work, 'typemismatch.cherrybackup')
    await writeRawZip(outPath, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(fullManifest(meta, payloads))) },
      { name: 'backup.sqlite', data: await readFile(dbPath) },
      { name: 'resources/Data/KnowledgeBase/kb', data: Buffer.from('not-a-directory') }
    ])
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toMatchObject({ reason: 'payload-mismatch' })
  })

  it('cancels mid-DB-verification and leaves no staging', async () => {
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const outPath = path.join(work, 'midverify.cherrybackup')
    await publishArchive({ outPath, manifest: liteManifest(meta), dbCopyPath: dbPath })
    const ac = new AbortController()
    hashStreamHooks.onChunk = () => ac.abort() // fires inside verifyDbPayload's cancellable hash
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder, signal: ac.signal })
    ).rejects.toBeInstanceOf(BackupCancelledError)
    expect((await readdir(stagingParent)).filter((n) => n.startsWith('cs-admit-'))).toEqual([])
  })

  it('cancels deterministically on the first DB extraction chunk and cleans owned staging', async () => {
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const outPath = path.join(work, 'midextract.cherrybackup')
    await publishArchive({ outPath, manifest: liteManifest(meta), dbCopyPath: dbPath })
    const ac = new AbortController()
    // Abort on the first chunk of backup.sqlite — proves the extraction chunk /
    // abort-listener path, not merely preflight cancellation.
    extractStreamHooks.onChunk = (_bytes, entry) => {
      if (entry === 'backup.sqlite') ac.abort()
    }
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder, signal: ac.signal })
    ).rejects.toBeInstanceOf(BackupCancelledError)
    expect((await readdir(stagingParent)).filter((n) => n.startsWith('cs-admit-'))).toEqual([])
  })

  it('preflights disk headroom and leaves no staging (siblings survive) when space is insufficient', async () => {
    const assertSurvives = await siblingSurvives()
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const outPath = path.join(work, 'nospace.cherrybackup')
    await publishArchive({ outPath, manifest: liteManifest(meta), dbCopyPath: dbPath })
    vi.spyOn(diskProbe, 'statfs').mockResolvedValue({ bavail: 0, bsize: 4096 } as unknown as Awaited<
      ReturnType<typeof diskProbe.statfs>
    >)
    await expect(
      admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })
    ).rejects.toBeInstanceOf(InsufficientDiskSpaceError)
    await assertSurvives()
  })

  it('returned cleanup rejects (staging-escape) and preserves a replacement root of different identity', async () => {
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const outPath = path.join(work, 'ownership.cherrybackup')
    await publishArchive({ outPath, manifest: liteManifest(meta), dbCopyPath: dbPath })
    const admitted = await admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })

    // Replace the owned root with a symlink to a foreign directory. Note the
    // replacement may inherit the freed directory's dev/ino — inode recycling is
    // real and platform-dependent — so the type check, not the numbers, is what
    // has to hold this case up.
    const foreign = path.join(work, 'foreign-real')
    await mkdir(foreign)
    await writeFile(path.join(foreign, 'keep.txt'), 'FOREIGN')
    await rm(admitted.stagingDir, { recursive: true, force: true })
    await symlink(foreign, admitted.stagingDir)

    // Must NOT silently resolve — the caller would wrongly assume the staging DB
    // was cleaned. It rejects and leaves the replacement untouched.
    await expect(admitted.cleanup()).rejects.toMatchObject({ reason: 'staging-escape' })
    expect(existsSync(path.join(foreign, 'keep.txt'))).toBe(true)
    expect((await lstat(admitted.stagingDir)).isSymbolicLink()).toBe(true)
  })

  it('returned cleanup rejects when a real directory of another identity took the root', async () => {
    const dbPath = await snapshotDbAt()
    const meta = await dbMeta(dbPath)
    const outPath = path.join(work, 'ownership-dir.cherrybackup')
    await publishArchive({ outPath, manifest: liteManifest(meta), dbCopyPath: dbPath })
    const admitted = await admitArchive({ archivePath: outPath, stagingParent, migrationsFolder: realFolder })

    // A directory of the right TYPE but the wrong inode: the identity half of
    // the check is what refuses this one.
    const replacement = path.join(work, 'replacement-dir')
    await mkdir(replacement)
    await writeFile(path.join(replacement, 'keep.txt'), 'REPLACEMENT')
    await rm(admitted.stagingDir, { recursive: true, force: true })
    await rename(replacement, admitted.stagingDir)

    await expect(admitted.cleanup()).rejects.toMatchObject({ reason: 'staging-escape' })
    expect(existsSync(path.join(admitted.stagingDir, 'keep.txt'))).toBe(true)
  })
})

async function sha256Buffer(buf: Buffer): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(buf).digest('hex')
}
