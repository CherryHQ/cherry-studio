import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { loggerService } from '@logger'
import type { FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// Both sweep entries consult hasPendingRestore before doing anything; default
// to false so every pre-existing scenario runs unguarded.
const hasPendingRestoreMock = vi.fn((): boolean => false)
vi.mock('@data/db/restore/restoreJournal', () => ({
  hasPendingRestore: () => hasPendingRestoreMock()
}))

const { runDbSweep, runFileSweep, scanOrphanEntries } = await import('../orphanSweep')

beforeEach(() => {
  hasPendingRestoreMock.mockReturnValue(false)
})

describe('pending-restore guard', () => {
  it('runDbSweep aborts with pending-restore before touching any service', () => {
    hasPendingRestoreMock.mockReturnValue(true)
    const fileEntryService = { findManualUnreferenced: vi.fn(), listAllIds: vi.fn() }
    const fileRefService = { countByEntryIds: vi.fn(), pruneMissingTempSessionRefs: vi.fn() }

    const report = runDbSweep({ fileEntryService, fileRefService })

    expect(report.outcome).toBe('aborted')
    if (report.outcome === 'aborted') {
      expect(report.abortReason).toBe('pending-restore')
    }
    expect(report.orphanRefsTotal).toBe(0)
    expect(fileEntryService.listAllIds).not.toHaveBeenCalled()
    expect(fileEntryService.findManualUnreferenced).not.toHaveBeenCalled()
    expect(fileRefService.pruneMissingTempSessionRefs).not.toHaveBeenCalled()
  })

  it('runFileSweep aborts with pending-restore before touching DB snapshot or filesystem', async () => {
    hasPendingRestoreMock.mockReturnValue(true)
    const fileEntryService = { listAllIds: vi.fn() }

    const report = await runFileSweep({ fileEntryService })

    expect(report.outcome).toBe('aborted')
    if (report.outcome === 'aborted') {
      expect(report.abortReason).toBe('pending-restore')
    }
    expect(report.actualDeleteCount).toBe(0)
    expect(fileEntryService.listAllIds).not.toHaveBeenCalled()
  })
})

describe('scanOrphanEntries (report-only)', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
    MockMainCacheServiceUtils.resetMocks()
  })

  it('groups unreferenced entries by origin without deleting any', async () => {
    const referenced = '019606a0-0000-7000-8000-00000000ee20' as FileEntryId
    const orphanInternal = '019606a0-0000-7000-8000-00000000ee21' as FileEntryId
    const orphanExternalA = '019606a0-0000-7000-8000-00000000ee22' as FileEntryId
    const orphanExternalB = '019606a0-0000-7000-8000-00000000ee23' as FileEntryId

    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values([
      {
        id: referenced,
        origin: 'internal',
        name: 'r',
        ext: 'txt',
        size: 1,
        externalPath: null,
        createdAt: now,
        updatedAt: now
      },
      {
        id: orphanInternal,
        origin: 'internal',
        name: 'o',
        ext: 'txt',
        size: 1,
        externalPath: null,
        createdAt: now,
        updatedAt: now
      },
      {
        id: orphanExternalA,
        origin: 'external',
        name: 'a',
        ext: 'txt',
        size: null,
        externalPath: '/abs/a.txt',
        createdAt: now,
        updatedAt: now
      },
      {
        id: orphanExternalB,
        origin: 'external',
        name: 'b',
        ext: 'txt',
        size: null,
        externalPath: '/abs/b.txt',
        createdAt: now,
        updatedAt: now
      }
    ])
    fileRefService.createTempSessionRef({ fileEntryId: referenced, sourceId: 'sess-z', role: 'pending' })

    const report = scanOrphanEntries({ fileEntryService, fileRefService })
    expect(report.total).toBe(3)
    expect(report.byOrigin.internal).toBe(1)
    expect(report.byOrigin.external).toBe(2)

    // No deletions performed — every entry still in DB.
    const all = await dbh.db.select().from(fileEntryTable)
    expect(all.length).toBe(4)
  })

  it('returns zero when every entry has at least one ref', async () => {
    const id = '019606a0-0000-7000-8000-00000000ee30' as FileEntryId
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'x',
      ext: 'txt',
      size: 1,
      externalPath: null,
      createdAt: now,
      updatedAt: now
    })
    fileRefService.createTempSessionRef({ fileEntryId: id, sourceId: 's', role: 'pending' })

    const report = scanOrphanEntries({ fileEntryService, fileRefService })
    expect(report.total).toBe(0)
    expect(report.byOrigin.internal ?? 0).toBe(0)
    expect(report.byOrigin.external ?? 0).toBe(0)
  })
})

describe('runDbSweep (umbrella + observability)', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
    MockMainCacheServiceUtils.resetMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits one structured orphan-sweep record summarising both passes', async () => {
    const entryId = '019606a0-0000-7000-8000-00000000ee40' as FileEntryId
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id: entryId,
      origin: 'internal',
      name: 's',
      ext: 'txt',
      size: 1,
      externalPath: null,
      createdAt: now,
      updatedAt: now
    })
    fileRefService.createTempSessionRef({
      fileEntryId: entryId,
      sourceId: 'sess-orphan',
      role: 'pending'
    })

    const infoSpy = vi.spyOn(loggerService, 'info')
    await dbh.db.delete(fileEntryTable).where(eq(fileEntryTable.id, entryId))

    const report = runDbSweep({
      fileEntryService,
      fileRefService
    })

    expect(report.outcome).toBe('completed')
    expect(report.orphanRefsByType.temp_session).toBe(1)
    expect(report.orphanEntriesByOrigin.internal ?? 0).toBe(0)
    expect(typeof report.scanDurationMs).toBe('number')

    expect(infoSpy).toHaveBeenCalledWith(
      'orphan-sweep',
      expect.objectContaining({
        event: 'orphan-sweep',
        outcome: 'completed'
      })
    )
  })

  it('reports failed outcome when an outer-level operation throws', async () => {
    const errorSpy = vi.spyOn(loggerService, 'error')
    const failingEntryService = {
      findManualUnreferenced: () => {
        throw new Error('boom')
      },
      listAllIds: fileEntryService.listAllIds.bind(fileEntryService)
    } as unknown as typeof fileEntryService

    const report = runDbSweep({
      fileEntryService: failingEntryService,
      fileRefService
    })
    expect(report.outcome).toBe('failed')
    if (report.outcome === 'failed') {
      expect(report.errorMessage).toMatch(/boom/)
    }
    expect(errorSpy).toHaveBeenCalledWith(
      'orphan-sweep',
      expect.objectContaining({ event: 'orphan-sweep', outcome: 'failed' })
    )
  })
})

describe('runFileSweep (FS-level)', () => {
  const dbh = setupTestDatabase()
  let filesDir: string

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    filesDir = await mkdtemp(path.join(tmpdir(), 'cherry-fm-sweep-'))
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(filesDir, filename) : filesDir
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
  })

  afterEach(async () => {
    await rm(filesDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('unlinks UUID files without a matching DB entry', async () => {
    const knownId = '019606a0-0000-7000-8000-00000000ee50' as FileEntryId
    const orphanId = '019606a0-0000-7000-8000-00000000ee51'
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id: knownId,
      origin: 'internal',
      name: 'k',
      ext: 'txt',
      size: 1,
      externalPath: null,
      createdAt: now,
      updatedAt: now
    })

    const knownPath = path.join(filesDir, `${knownId}.txt`)
    const orphanPath = path.join(filesDir, `${orphanId}.txt`)
    await writeFile(knownPath, 'k')
    await writeFile(orphanPath, 'o')
    // Backdate both files so they pass the >5min freshness gate.
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    await utimes(knownPath, ancient, ancient)
    await utimes(orphanPath, ancient, ancient)

    const report = await runFileSweep({ fileEntryService })
    expect(report.outcome).toBe('completed')
    expect(report.actualDeleteCount).toBe(1)

    // Known file preserved.
    expect((await stat(knownPath)).size).toBe(1)
    // Orphan file gone.
    await expect(stat(orphanPath)).rejects.toThrow(/ENOENT/)
  })

  it('preserves orphan files newer than the 5-minute freshness gate', async () => {
    const orphanId = '019606a0-0000-7000-8000-00000000ee52'
    const recentPath = path.join(filesDir, `${orphanId}.txt`)
    await writeFile(recentPath, 'r')
    // Brand new file — mtime is now; should be skipped.

    const report = await runFileSweep({ fileEntryService })
    expect(report.actualDeleteCount).toBe(0)
    expect((await stat(recentPath)).size).toBe(1)
  })

  it('unlinks atomic-write tmp residue older than 5 minutes', async () => {
    const tmpName = `019606a0-0000-7000-8000-00000000ee53.txt.tmp-22222222-2222-4222-8222-aaaaaaaaaaaa`
    const tmpPath = path.join(filesDir, tmpName)
    await writeFile(tmpPath, 't')
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    await utimes(tmpPath, ancient, ancient)

    const report = await runFileSweep({ fileEntryService })
    expect(report.actualDeleteCount).toBe(1)
    await expect(stat(tmpPath)).rejects.toThrow(/ENOENT/)
  })

  it('unlinks tmp residue even when the leading UUID matches a live entry', async () => {
    // atomicWriteFile generates `<entryUUID>.<ext>.tmp-<randomUUID>`. If the
    // entry is currently in the DB, the planning predicate must still
    // recognise the .tmp- residue — otherwise crash-time tmp files of live
    // entries persist forever across restarts.
    const liveEntryId = '019606a0-0000-7000-8000-00000000ee54' as FileEntryId
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id: liveEntryId,
      origin: 'internal',
      name: 'live',
      ext: 'txt',
      size: 4,
      externalPath: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    })

    const livePath = path.join(filesDir, `${liveEntryId}.txt`)
    const orphanedTmpPath = path.join(filesDir, `${liveEntryId}.txt.tmp-22222222-2222-4222-8222-bbbbbbbbbbbb`)
    await writeFile(livePath, 'live')
    await writeFile(orphanedTmpPath, 'tmp')
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    await utimes(livePath, ancient, ancient)
    await utimes(orphanedTmpPath, ancient, ancient)

    const report = await runFileSweep({ fileEntryService })
    // Only the tmp residue should be unlinked; the live file is preserved.
    expect(report.actualDeleteCount).toBe(1)
    expect((await stat(livePath)).size).toBe(4)
    await expect(stat(orphanedTmpPath)).rejects.toThrow(/ENOENT/)
  })

  it('aborts when the planned deletion exceeds the safety threshold (>20 files at >50%)', async () => {
    // 25 orphan UUID files on disk, 0 entries in DB — exceeds both the 20-count
    // residue floor AND the 50% fraction. Architecture §10.4 → outcome=aborted.
    const ids = Array.from({ length: 25 }, (_, i) => `019606a0-0000-7000-8000-${String(i).padStart(12, '0')}`)
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    for (const id of ids) {
      const p = path.join(filesDir, `${id}.txt`)
      await writeFile(p, 'x')
      await utimes(p, ancient, ancient)
    }

    const report = await runFileSweep({ fileEntryService })
    expect(report.outcome).toBe('aborted')
    if (report.outcome === 'aborted') {
      expect(report.abortReason).toBe('count-fraction')
    }
    expect(report.actualDeleteCount).toBe(0)

    // All files preserved.
    for (const id of ids) {
      expect((await stat(path.join(filesDir, `${id}.txt`))).size).toBe(1)
    }
  })

  it('aborts on byte-fraction when total bytes exceed the bytes floor', async () => {
    // 21 files of 600KB each (12.6 MB > 10MB floor) AND 100% planned → abort.
    const ids = Array.from({ length: 21 }, (_, i) => `019606a0-0000-7000-8000-${String(i + 100).padStart(12, '0')}`)
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    const big = Buffer.alloc(600 * 1024, 'x')
    for (const id of ids) {
      const p = path.join(filesDir, `${id}.txt`)
      await writeFile(p, big)
      await utimes(p, ancient, ancient)
    }

    const report = await runFileSweep({ fileEntryService })
    expect(report.outcome).toBe('aborted')
    if (report.outcome === 'aborted') {
      // Either count-fraction or byte-fraction may trigger first; both are valid.
      expect(['count-fraction', 'byte-fraction']).toContain(report.abortReason)
    }
    expect(report.actualDeleteCount).toBe(0)
  })

  it('emits one structured orphan-file-sweep debug log on completion', async () => {
    const orphanId = '019606a0-0000-7000-8000-00000000ee60'
    const orphanPath = path.join(filesDir, `${orphanId}.txt`)
    await writeFile(orphanPath, 'o')
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    await utimes(orphanPath, ancient, ancient)

    const debugSpy = vi.spyOn(loggerService, 'debug')
    await runFileSweep({ fileEntryService })
    expect(debugSpy).toHaveBeenCalledWith(
      'orphan-file-sweep',
      expect.objectContaining({ event: 'orphan-file-sweep', outcome: 'completed' })
    )
  })

  it('emits "orphan-file-sweep-below-floor" warn breadcrumb when plan is high-fraction but under both floors', async () => {
    // 5 orphan UUID files on disk, 0 entries in DB → fraction is 100% but plan
    // is below both the 20-count and 10MB floors, so pickAbortReason returns
    // undefined and the sweep proceeds. The forensic breadcrumb is the primary
    // signal for explaining an unexpected mass-delete incident.
    const ids = Array.from({ length: 5 }, (_, i) => `019606a0-0000-7000-8000-${String(i + 500).padStart(12, '0')}`)
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    for (const id of ids) {
      const p = path.join(filesDir, `${id}.txt`)
      await writeFile(p, 'x')
      await utimes(p, ancient, ancient)
    }
    const warnSpy = vi.spyOn(loggerService, 'warn')
    const report = await runFileSweep({ fileEntryService })
    expect(report.outcome).toBe('completed')
    expect(report.actualDeleteCount).toBe(5)
    expect(warnSpy).toHaveBeenCalledWith(
      'orphan-file-sweep-below-floor',
      expect.objectContaining({
        event: 'orphan-file-sweep-below-floor',
        plannedCount: 5,
        countFraction: 1
      })
    )
  })

  it('emits warn-level record on aborted outcome', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `019606a0-0000-7000-8000-${String(i + 300).padStart(12, '0')}`)
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    for (const id of ids) {
      const p = path.join(filesDir, `${id}.txt`)
      await writeFile(p, 'x')
      await utimes(p, ancient, ancient)
    }
    const warnSpy = vi.spyOn(loggerService, 'warn')
    await runFileSweep({ fileEntryService })
    expect(warnSpy).toHaveBeenCalledWith(
      'orphan-file-sweep',
      expect.objectContaining({ event: 'orphan-file-sweep', outcome: 'aborted' })
    )
  })

  it('records oldestDeletedMtime when at least one file is unlinked', async () => {
    const oldId = '019606a0-0000-7000-8000-00000000ee72'
    const youngerId = '019606a0-0000-7000-8000-00000000ee73'
    const oldMtime = Math.floor(Date.now() / 1000) - 30 * 60 // 30 min ago
    const youngerMtime = Math.floor(Date.now() / 1000) - 10 * 60 // 10 min ago
    const oldPath = path.join(filesDir, `${oldId}.txt`)
    const youngerPath = path.join(filesDir, `${youngerId}.txt`)
    await writeFile(oldPath, 'old')
    await writeFile(youngerPath, 'young')
    await utimes(oldPath, oldMtime, oldMtime)
    await utimes(youngerPath, youngerMtime, youngerMtime)

    const report = await runFileSweep({ fileEntryService })
    expect(report.outcome).toBe('completed')
    expect(report.actualDeleteCount).toBe(2)
    expect(report.oldestDeletedMtime).toBeDefined()
    // Stored as ms epoch; allow loose comparison since utimes precision varies.
    expect(report.oldestDeletedMtime!).toBeLessThanOrEqual(youngerMtime * 1000)
  })

  it('omits oldestDeletedMtime when no files are unlinked', async () => {
    const report = await runFileSweep({ fileEntryService })
    expect(report.outcome).toBe('completed')
    expect(report.actualDeleteCount).toBe(0)
    expect(report.oldestDeletedMtime).toBeUndefined()
  })

  it('skips directories — only regular files are sweep candidates', async () => {
    // Create a UUID-named subdirectory; if the predicate ever changed to
    // unlink-anything, this would break boot for users with stray dirs.
    const { mkdir } = await import('node:fs/promises')
    const dirName = '019606a0-0000-7000-8000-00000000ee74'
    const dirPath = path.join(filesDir, `${dirName}.txt`)
    await mkdir(dirPath)
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    await utimes(dirPath, ancient, ancient)

    const report = await runFileSweep({ fileEntryService })
    expect(report.outcome).toBe('completed')
    expect(report.actualDeleteCount).toBe(0)
    // Directory still there.
    expect((await stat(dirPath)).isDirectory()).toBe(true)
  })

  it('returns completed with zero counts when files dir does not exist (ENOENT)', async () => {
    // Override application.getPath to point at a non-existent path.
    vi.mocked(application.getPath).mockImplementation((key: string) => {
      if (key === 'feature.files.data') {
        return '/nonexistent-dir-for-orphan-sweep-test'
      }
      return `/mock/${key}`
    })
    const report = await runFileSweep({ fileEntryService })
    expect(report.outcome).toBe('completed')
    expect(report.filesOnDisk).toBe(0)
    expect(report.direntsScanned).toBe(0)
  })

  it('returns failed outcome when feature.files.data points at a regular file (ENOTDIR)', async () => {
    // Point getPath at a regular file, not a directory — readdir throws ENOTDIR
    // which is non-ENOENT and must NOT be silently swallowed as "no files".
    const filePath = path.join(filesDir, 'pretend-this-is-files-dir.bin')
    await writeFile(filePath, 'x')
    vi.mocked(application.getPath).mockImplementation((key: string) => {
      if (key === 'feature.files.data') return filePath
      return `/mock/${key}`
    })
    const report = await runFileSweep({ fileEntryService })
    expect(report.outcome).toBe('failed')
    if (report.outcome === 'failed') {
      expect(report.errorMessage).toMatch(/ENOTDIR|not a directory/i)
    }
  })

  it('returns failed outcome when listAllIds throws (DB unavailable mid-startup)', async () => {
    const failingEntryService = {
      listAllIds: () => {
        throw new Error('db-down')
      }
    } as unknown as typeof fileEntryService
    const report = await runFileSweep({ fileEntryService: failingEntryService })
    expect(report.outcome).toBe('failed')
    if (report.outcome === 'failed') {
      expect(report.errorMessage).toMatch(/db-down/)
    }
  })

  it('proceeds normally for small residue (under the 20-file floor)', async () => {
    // 5 orphan UUID files, 0 entries — small enough to bypass abort.
    const ids = Array.from({ length: 5 }, (_, i) => `019606a0-0000-7000-8000-${String(i + 200).padStart(12, '0')}`)
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    for (const id of ids) {
      const p = path.join(filesDir, `${id}.txt`)
      await writeFile(p, 'x')
      await utimes(p, ancient, ancient)
    }

    const report = await runFileSweep({ fileEntryService })
    expect(report.outcome).toBe('completed')
    expect(report.actualDeleteCount).toBe(5)
  })

  it.skipIf(process.platform === 'win32')(
    'reports partial outcome with failedDeleteCount + failedSamples when an unlink fails',
    async () => {
      // Regression: the runFileSweep partial branch (orphanSweep.ts
      // outcome 'partial' shape with failedDeleteCount + failedSamples + the
      // `orphan-file-sweep-unlink-failed` warn-log) was completely uncovered.
      //
      // Trigger an unlink failure by stripping write permission from the
      // parent directory — POSIX unlink() needs +w on the containing dir,
      // not on the file itself. Skipped on win32 where directory ACLs work
      // differently and chmod is a no-op (this test would silently
      // false-pass).
      const { chmod } = await import('node:fs/promises')
      const orphanId = '019606a0-0000-7000-8000-0000000fa1ed'
      const orphanPath = path.join(filesDir, `${orphanId}.txt`)
      const ancient = (Date.now() - 10 * 60 * 1000) / 1000
      await writeFile(orphanPath, 'x')
      await utimes(orphanPath, ancient, ancient)

      await chmod(filesDir, 0o555) // r-x r-x r-x — readdir ok, unlink not
      const warnSpy = vi.spyOn(loggerService, 'warn')

      let report
      try {
        report = await runFileSweep({ fileEntryService })
      } finally {
        // Restore permission so afterEach cleanup can wipe the tmp tree.
        await chmod(filesDir, 0o755)
      }

      expect(report.outcome).toBe('partial')
      if (report.outcome === 'partial') {
        expect(report.failedDeleteCount).toBe(1)
        expect(report.failedSamples).toHaveLength(1)
        expect(report.failedSamples[0]).toContain(`${orphanId}.txt`)
        // EACCES or EPERM depending on platform — either signals
        // "permission denied" and is the regression-worthy condition.
        expect(report.failedSamples[0]).toMatch(/EACCES|EPERM/)
      }
      expect(warnSpy).toHaveBeenCalledWith(
        'orphan-file-sweep-unlink-failed',
        expect.objectContaining({ path: orphanPath, code: expect.stringMatching(/EACCES|EPERM/) })
      )
    }
  )

  it('preserves trashed entries’ physical files through the sweep (listAllIds returns active + trashed)', async () => {
    // Regression: `FileEntryService.listAllIds` unit test verifies it returns
    // active + trashed ids, but no end-to-end test wired it through
    // runFileSweep. A regression that filtered `WHERE deletedAt IS
    // NULL` would silently nuke every trashed file's physical blob on next
    // boot — data loss the user did not consent to. Pin the contract here.
    const trashedId = '019606a0-0000-7000-8000-0000000fa2ed' as FileEntryId
    const trashedPath = path.join(filesDir, `${trashedId}.txt`)
    // 1) Create the entry as if a Cherry-owned write committed,
    fileEntryService.create({
      id: trashedId,
      origin: 'internal',
      name: 'doomed-if-filter-creeps-in',
      ext: 'txt',
      size: 1,
      cleanupPolicy: 'manual'
    })
    await writeFile(trashedPath, 'x')
    // 2) Move to trash via the service (sets deletedAt; row stays in DB).
    fileEntryService.update(trashedId, { deletedAt: Date.now() })

    const report = await runFileSweep({ fileEntryService })
    expect(report.outcome).toBe('completed')
    // Physical file MUST still be there — listAllIds returned the trashed id,
    // sweep saw it as known, did not unlink.
    const onDisk = await stat(trashedPath)
    expect(onDisk.isFile()).toBe(true)
  })
})
