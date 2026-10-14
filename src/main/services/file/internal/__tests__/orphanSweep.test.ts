import { lstat, mkdtemp, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { v4 as uuidv4 } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { paintingFileRefTable } from '@data/db/schemas/fileRelations'
import { paintingTable } from '@data/db/schemas/painting'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { loggerService } from '@logger'
import type { FileEntryId } from '@shared/data/types/file'

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

const { inspectFileSweep, runDbSweep, runFileSweep, scanOrphanEntries } = await import('../orphanSweep')

beforeEach(() => {
  hasPendingRestoreMock.mockReturnValue(false)
})

describe('pending-restore guard', () => {
  it('runDbSweep aborts with pending-restore before touching any service', () => {
    hasPendingRestoreMock.mockReturnValue(true)
    const fileEntryService = { findManualUnreferenced: vi.fn() }
    const fileRefService = { countByEntryIds: vi.fn() }

    const report = runDbSweep({ fileEntryService, fileRefService })

    expect(report.outcome).toBe('aborted')
    if (report.outcome === 'aborted') {
      expect(report.abortReason).toBe('pending-restore')
    }
    expect(fileEntryService.findManualUnreferenced).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'file sweep stands aside for a pending restore even with bypassSafetyThreshold=%s',
    async (bypassSafetyThreshold) => {
      hasPendingRestoreMock.mockReturnValue(true)
      const fileEntryService = { listAllIds: vi.fn(), findById: vi.fn() }

      const options = { bypassSafetyThreshold }
      const reports = await Promise.all([
        inspectFileSweep({ fileEntryService }, options),
        runFileSweep({ fileEntryService }, options)
      ])

      for (const report of reports) {
        expect(report).toMatchObject({ outcome: 'aborted', abortReason: 'pending-restore', actualDeleteCount: 0 })
      }
      expect(fileEntryService.listAllIds).not.toHaveBeenCalled()
    }
  )
})

describe('scanOrphanEntries (report-only)', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
    MockMainCacheServiceUtils.resetMocks()
  })

  // Give an entry a persistent (painting) ref so the sweep treats it as
  // referenced — the canonical fixture for "this entry is not an orphan".
  async function seedPersistentRef(fileEntryId: FileEntryId): Promise<void> {
    const paintingId = uuidv4()
    await dbh.db.insert(paintingTable).values({
      id: paintingId,
      providerId: 'provider',
      modelId: null,
      prompt: 'prompt',
      orderKey: paintingId
    })
    await dbh.db.insert(paintingFileRefTable).values({ fileEntryId, sourceId: paintingId, role: 'output' })
  }

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
    await seedPersistentRef(referenced)

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
    await seedPersistentRef(id)

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

  it('reports orphan bytes without unlinking during inspection', async () => {
    const orphanId = '019606a0-0000-7000-8000-00000000ee49'
    const orphanPath = path.join(filesDir, `${orphanId}.txt`)
    await writeFile(orphanPath, 'inspect')
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    await utimes(orphanPath, ancient, ancient)
    const debugSpy = vi.spyOn(loggerService, 'debug')

    const report = await inspectFileSweep({ fileEntryService })

    expect(report).toMatchObject({
      outcome: 'completed',
      plannedDeleteCount: 1,
      plannedDeleteBytes: 7,
      actualDeleteCount: 0,
      actualDeleteBytes: 0
    })
    expect(debugSpy).toHaveBeenCalledWith(
      'orphan-file-sweep',
      expect.objectContaining({ event: 'orphan-file-sweep', outcome: 'completed' })
    )
    await expect(stat(orphanPath)).resolves.toBeDefined()
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

  it.each([false, true])(
    'preserves UUID-named symbolic links with bypassSafetyThreshold=%s',
    async (bypassSafetyThreshold) => {
      const orphanId = '019606a0-0000-7000-8000-00000000ee52'
      const targetPath = path.join(filesDir, 'keep.txt')
      const linkPath = path.join(filesDir, `${orphanId}.txt`)
      await writeFile(targetPath, 'keep')
      const ancient = (Date.now() - 10 * 60 * 1000) / 1000
      await utimes(targetPath, ancient, ancient)
      await symlink(targetPath, linkPath)

      const report = await runFileSweep({ fileEntryService }, { bypassSafetyThreshold })

      expect(report).toMatchObject({ outcome: 'completed', plannedDeleteCount: 0, actualDeleteCount: 0 })
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
      expect((await stat(targetPath)).size).toBe(4)
    }
  )

  it.each([false, true])(
    'preserves fresh orphan files with bypassSafetyThreshold=%s',
    async (bypassSafetyThreshold) => {
      const orphanId = '019606a0-0000-7000-8000-00000000ee52'
      const recentPath = path.join(filesDir, `${orphanId}.txt`)
      await writeFile(recentPath, 'r')
      // Brand new file — mtime is now; should be skipped.

      const report = await runFileSweep({ fileEntryService }, { bypassSafetyThreshold })
      expect(report.actualDeleteCount).toBe(0)
      expect((await stat(recentPath)).size).toBe(1)
    }
  )

  it.each([
    [true, false],
    [false, false],
    [true, true],
    [false, true]
  ])(
    'preserves intake-protected files (protected during planning: %s, bypassSafetyThreshold: %s)',
    async (protectedDuringPlanning, bypassSafetyThreshold) => {
      const orphanId = '019606a0-0000-7000-8000-00000000ee54'
      const orphanPath = path.join(filesDir, `${orphanId}.txt`)
      await writeFile(orphanPath, 'upload')
      const ancient = (Date.now() - 10 * 60 * 1000) / 1000
      await utimes(orphanPath, ancient, ancient)
      let protectionActive = protectedDuringPlanning
      const intakeProtection = {
        load: () => Promise.resolve(),
        isProtected: (id: string) => {
          if (id !== orphanId) return false
          const protectedNow = protectionActive
          protectionActive = true
          return protectedNow
        }
      }

      const report = await runFileSweep({ fileEntryService, intakeProtection }, { bypassSafetyThreshold })

      expect(report).toMatchObject({ outcome: 'completed', actualDeleteCount: 0, actualDeleteBytes: 0 })
      expect((await stat(orphanPath)).size).toBe(6)
    }
  )

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

  it.each(['txt', null])('unlinks tmp residue next to a live entry with extension %s', async (ext) => {
    // A retained entry must not hide its abandoned atomic-write residue.
    const liveEntryId = '019606a0-0000-7000-8000-00000000ee54' as FileEntryId
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id: liveEntryId,
      origin: 'internal',
      name: 'live',
      ext,
      size: 4,
      externalPath: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    })

    const livePath = path.join(filesDir, `${liveEntryId}${ext ? `.${ext}` : ''}`)
    const orphanedTmpPath = `${livePath}.tmp-22222222-2222-4222-8222-bbbbbbbbbbbb`
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

  it('rechecks a tmp-shaped blob retained after the initial DB snapshot', async () => {
    const id = '019606a0-0000-7000-8000-00000000ee55'
    const ext = 'tmp-22222222-2222-4222-8222-aaaaaaaaaaaa'
    const physicalPath = path.join(filesDir, `${id}.${ext}`)
    await writeFile(physicalPath, 'published')
    const now = Date.now()
    const ancient = (now - 10 * 60 * 1000) / 1000
    await utimes(physicalPath, ancient, ancient)

    const report = await runFileSweep({
      fileEntryService,
      now: () => {
        dbh.db
          .insert(fileEntryTable)
          .values({
            id,
            origin: 'internal',
            name: 'published',
            ext,
            size: 9,
            cleanupPolicy: 'manual',
            createdAt: now,
            updatedAt: now
          })
          .run()
        return now
      }
    })

    expect(report).toMatchObject({ outcome: 'completed', plannedDeleteCount: 1, actualDeleteCount: 0 })
    expect((await stat(physicalPath)).size).toBe(9)
    expect(fileEntryService.getById(id)).toMatchObject({ ext, cleanupPolicy: 'manual' })
  })

  it('counts and deletes more than 20 old orphan files when bypassing the safety threshold', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `019606a0-0000-7000-8000-${String(i).padStart(12, '0')}`)
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    for (const id of ids) {
      const p = path.join(filesDir, `${id}.txt`)
      await writeFile(p, 'x')
      await utimes(p, ancient, ancient)
    }

    const inspection = await inspectFileSweep({ fileEntryService }, { bypassSafetyThreshold: true })
    expect(inspection).toMatchObject({
      outcome: 'completed',
      plannedDeleteCount: 25,
      plannedDeleteBytes: 25,
      actualDeleteCount: 0,
      actualDeleteBytes: 0
    })
    for (const id of ids) {
      expect((await stat(path.join(filesDir, `${id}.txt`))).size).toBe(1)
    }

    const report = await runFileSweep({ fileEntryService }, { bypassSafetyThreshold: true })
    expect(report).toMatchObject({ outcome: 'completed', actualDeleteCount: 25, actualDeleteBytes: 25 })
    for (const id of ids) {
      await expect(stat(path.join(filesDir, `${id}.txt`))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('counts and deletes more than 10 MiB of old orphan files when bypassing the safety threshold', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `019606a0-0000-7000-8000-${String(i + 100).padStart(12, '0')}`)
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    const big = Buffer.alloc(600 * 1024, 'x')
    for (const id of ids) {
      const p = path.join(filesDir, `${id}.txt`)
      await writeFile(p, big)
      await utimes(p, ancient, ancient)
    }

    const inspection = await inspectFileSweep({ fileEntryService }, { bypassSafetyThreshold: true })
    expect(inspection).toMatchObject({
      outcome: 'completed',
      plannedDeleteCount: 21,
      plannedDeleteBytes: 21 * 600 * 1024,
      actualDeleteCount: 0,
      actualDeleteBytes: 0
    })
    for (const id of ids) {
      expect((await stat(path.join(filesDir, `${id}.txt`))).size).toBe(600 * 1024)
    }

    const report = await runFileSweep({ fileEntryService }, { bypassSafetyThreshold: true })
    expect(report).toMatchObject({
      outcome: 'completed',
      actualDeleteCount: 21,
      actualDeleteBytes: 21 * 600 * 1024
    })
    for (const id of ids) {
      await expect(stat(path.join(filesDir, `${id}.txt`))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it.each([
    { fileCount: 25, freshFileCount: 0, bytesPerFile: 1, abortReason: 'count-fraction' },
    { fileCount: 1, freshFileCount: 2, bytesPerFile: 11 * 1024 * 1024, abortReason: 'byte-fraction' }
  ])(
    'preserves orphan files on a default $abortReason abort',
    async ({ fileCount, freshFileCount, bytesPerFile, abortReason }) => {
      const ids = Array.from(
        { length: fileCount },
        (_, i) => `019606a0-0000-7000-8000-${String(i + 300).padStart(12, '0')}`
      )
      const ancient = (Date.now() - 10 * 60 * 1000) / 1000
      for (const id of ids) {
        const targetPath = path.join(filesDir, `${id}.txt`)
        await writeFile(targetPath, Buffer.alloc(bytesPerFile))
        await utimes(targetPath, ancient, ancient)
      }
      for (let i = 0; i < freshFileCount; i++) {
        await writeFile(path.join(filesDir, `019606a0-0000-7000-8000-${String(i + 350).padStart(12, '0')}.txt`), 'x')
      }

      const inspection = await inspectFileSweep({ fileEntryService })
      const cleanup = await runFileSweep({ fileEntryService })

      for (const report of [inspection, cleanup]) {
        expect(report).toMatchObject({ outcome: 'aborted', abortReason, actualDeleteCount: 0, actualDeleteBytes: 0 })
      }
      for (const id of ids) {
        expect((await stat(path.join(filesDir, `${id}.txt`))).size).toBe(bytesPerFile)
      }
    }
  )

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

  it('cleans a small batch of old orphan files', async () => {
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
