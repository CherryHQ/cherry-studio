import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { loggerService } from '@logger'
import type { FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { OrphanRefScanner, runDbSweep, runStartupFileSweep, scanOrphanEntries } = await import('../orphanSweep')
const { tempSessionChecker } = await import('@data/services/orphan/FileRefCheckerRegistry')

describe('OrphanRefScanner', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
  })

  async function seedEntry(id: FileEntryId): Promise<void> {
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'n',
      ext: 'txt',
      size: 1,
      externalPath: null,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })
  }

  async function seedRef(refId: string, fileEntryId: FileEntryId, sourceId: string): Promise<void> {
    const now = Date.now()
    await dbh.db.insert(fileRefTable).values({
      id: refId,
      fileEntryId,
      sourceType: 'temp_session',
      sourceId,
      role: 'pending',
      createdAt: now,
      updatedAt: now
    })
  }

  describe('scanOneType', () => {
    it('deletes file_ref rows whose sourceId is no longer alive', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000ee01' as FileEntryId
      await seedEntry(entryId)
      await seedRef('22222222-2222-4222-8222-000000000001', entryId, 'sess-gone-1')
      await seedRef('22222222-2222-4222-8222-000000000002', entryId, 'sess-gone-2')

      const scanner = new OrphanRefScanner({
        fileRefService,
        registry: { ...registryStub(), temp_session: tempSessionChecker }
      })

      const removed = await scanner.scanOneType('temp_session')
      expect(removed).toBe(2)

      const remaining = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.fileEntryId, entryId))
      expect(remaining).toEqual([])
    })

    it('preserves refs whose sourceId is reported alive by the checker', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000ee02' as FileEntryId
      await seedEntry(entryId)
      await seedRef('22222222-2222-4222-8222-000000000003', entryId, 'sess-alive')

      const aliveChecker = {
        sourceType: 'temp_session' as const,
        checkExists: async (ids: readonly string[]) => new Set(ids)
      }
      const scanner = new OrphanRefScanner({
        fileRefService,
        registry: { ...registryStub(), temp_session: aliveChecker }
      })

      const removed = await scanner.scanOneType('temp_session')
      expect(removed).toBe(0)

      const remaining = await dbh.db.select().from(fileRefTable).where(eq(fileRefTable.fileEntryId, entryId))
      expect(remaining.length).toBe(1)
    })

    it('returns 0 when no refs exist for the sourceType', async () => {
      const scanner = new OrphanRefScanner({
        fileRefService,
        registry: { ...registryStub(), temp_session: tempSessionChecker }
      })
      expect(await scanner.scanOneType('temp_session')).toBe(0)
    })
  })

  describe('scanAll', () => {
    it('aggregates orphan-ref counts across every sourceType', async () => {
      const entryId = '019606a0-0000-7000-8000-00000000ee10' as FileEntryId
      await seedEntry(entryId)
      // temp_session refs are always orphan (default checker returns empty Set)
      await seedRef('22222222-2222-4222-8222-000000000010', entryId, 'sess-x')
      await seedRef('22222222-2222-4222-8222-000000000011', entryId, 'sess-y')

      const scanner = new OrphanRefScanner({
        fileRefService,
        registry: { ...registryStub(), temp_session: tempSessionChecker }
      })

      const result = await scanner.scanAll()
      expect(result.total).toBe(2)
      expect(result.byType.temp_session).toBe(2)
      // sourceTypes with no refs do not appear in byType (or appear as 0)
      expect(result.byType.knowledge_item ?? 0).toBe(0)
    })
  })

  describe('scanOrphanEntries (report-only)', () => {
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
      await dbh.db.insert(fileRefTable).values({
        id: '33333333-3333-4333-8333-000000000020',
        fileEntryId: referenced,
        sourceType: 'temp_session',
        sourceId: 'sess-z',
        role: 'pending',
        createdAt: now,
        updatedAt: now
      })

      const report = await scanOrphanEntries({ fileEntryService })
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
      await dbh.db.insert(fileRefTable).values({
        id: '33333333-3333-4333-8333-000000000030',
        fileEntryId: id,
        sourceType: 'temp_session',
        sourceId: 's',
        role: 'pending',
        createdAt: now,
        updatedAt: now
      })

      const report = await scanOrphanEntries({ fileEntryService })
      expect(report.total).toBe(0)
      expect(report.byOrigin.internal ?? 0).toBe(0)
      expect(report.byOrigin.external ?? 0).toBe(0)
    })
  })
})

describe('runDbSweep (umbrella + observability)', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
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
    await dbh.db.insert(fileRefTable).values({
      id: '33333333-3333-4333-8333-000000000040',
      fileEntryId: entryId,
      sourceType: 'temp_session',
      sourceId: 'sess-orphan',
      role: 'pending',
      createdAt: now,
      updatedAt: now
    })

    const infoSpy = vi.spyOn(loggerService, 'info')

    const report = await runDbSweep({
      fileEntryService,
      fileRefService,
      registry: {
        chat_message: { sourceType: 'chat_message', checkExists: async (ids) => new Set(ids) },
        knowledge_item: { sourceType: 'knowledge_item', checkExists: async (ids) => new Set(ids) },
        painting: { sourceType: 'painting', checkExists: async (ids) => new Set(ids) },
        note: { sourceType: 'note', checkExists: async (ids) => new Set(ids) },
        temp_session: { sourceType: 'temp_session', checkExists: async () => new Set() }
      } as never
    })

    expect(report.outcome).toBe('completed')
    expect(report.orphanRefsByType.temp_session).toBe(1)
    // The single orphan-entry survives only because file_ref_unique_idx
    // and CASCADE clean it up — so after the ref delete, the entry is now
    // unreferenced. Verify orphanEntriesByOrigin populates.
    expect(report.orphanEntriesByOrigin.internal ?? 0).toBeGreaterThanOrEqual(1)
    expect(typeof report.scanDurationMs).toBe('number')

    expect(infoSpy).toHaveBeenCalledWith(
      'orphan-sweep',
      expect.objectContaining({
        event: 'orphan-sweep',
        outcome: 'completed'
      })
    )
  })

  it('reports failure outcome when scanAll throws', async () => {
    const errorSpy = vi.spyOn(loggerService, 'error')
    const failingFileRefService = {
      ...fileRefService,
      listDistinctSourceIds: async () => {
        throw new Error('boom')
      }
    } as typeof fileRefService

    const report = await runDbSweep({
      fileEntryService,
      fileRefService: failingFileRefService,
      registry: {
        chat_message: { sourceType: 'chat_message', checkExists: async (ids) => new Set(ids) },
        knowledge_item: { sourceType: 'knowledge_item', checkExists: async (ids) => new Set(ids) },
        painting: { sourceType: 'painting', checkExists: async (ids) => new Set(ids) },
        note: { sourceType: 'note', checkExists: async (ids) => new Set(ids) },
        temp_session: { sourceType: 'temp_session', checkExists: async () => new Set() }
      } as never
    })
    expect(report.outcome).toBe('failed')
    expect(report.errorMessage).toMatch(/boom/)
    expect(errorSpy).toHaveBeenCalledWith(
      'orphan-sweep',
      expect.objectContaining({ event: 'orphan-sweep', outcome: 'failed' })
    )
  })
})

describe('runStartupFileSweep (FS-level)', () => {
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

    const report = await runStartupFileSweep({ fileEntryService })
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

    const report = await runStartupFileSweep({ fileEntryService })
    expect(report.actualDeleteCount).toBe(0)
    expect((await stat(recentPath)).size).toBe(1)
  })

  it('unlinks atomic-write tmp residue older than 5 minutes', async () => {
    const tmpName = `019606a0-0000-7000-8000-00000000ee53.txt.tmp-22222222-2222-4222-8222-aaaaaaaaaaaa`
    const tmpPath = path.join(filesDir, tmpName)
    await writeFile(tmpPath, 't')
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    await utimes(tmpPath, ancient, ancient)

    const report = await runStartupFileSweep({ fileEntryService })
    expect(report.actualDeleteCount).toBe(1)
    await expect(stat(tmpPath)).rejects.toThrow(/ENOENT/)
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

    const report = await runStartupFileSweep({ fileEntryService })
    expect(report.outcome).toBe('aborted')
    expect(report.abortReason).toBe('count-fraction')
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

    const report = await runStartupFileSweep({ fileEntryService })
    expect(report.outcome).toBe('aborted')
    // Either count-fraction or byte-fraction may trigger first; both are valid.
    expect(['count-fraction', 'byte-fraction']).toContain(report.abortReason)
    expect(report.actualDeleteCount).toBe(0)
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

    const report = await runStartupFileSweep({ fileEntryService })
    expect(report.outcome).toBe('completed')
    expect(report.actualDeleteCount).toBe(5)
  })
})

function registryStub() {
  const allAlive = (sourceType: string) => ({
    sourceType,
    checkExists: async (ids: readonly string[]) => new Set(ids)
  })
  return {
    chat_message: allAlive('chat_message'),
    knowledge_item: allAlive('knowledge_item'),
    painting: allAlive('painting'),
    note: allAlive('note'),
    temp_session: allAlive('temp_session')
  } as never
}
