import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { JobContext } from '@main/core/job/types'
import { DataApiErrorFactory } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { application } = await import('@application')
const { fileEntryService } = await import('@data/services/FileEntryService')
const { fileEntryTable } = await import('@data/db/schemas/file')
const { hashContent } = await import('@main/utils/file/contentHash')
const { contentHashBackfillJobHandler } = await import('../contentHashBackfillJobHandler')

function makeCtx(signal?: AbortSignal): JobContext<Record<string, never>> {
  return {
    jobId: 'test-backfill-job',
    input: {},
    signal: signal ?? new AbortController().signal,
    patchMetadata: vi.fn(),
    reportProgress: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  } as unknown as JobContext<Record<string, never>>
}

describe('contentHashBackfillJobHandler', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let filesDir: string

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-backfill-test-'))
    filesDir = path.join(tmp, 'Files')
    await mkdir(filesDir, { recursive: true })
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') return filename ? path.join(filesDir, filename) : filesDir
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tmp, { recursive: true, force: true })
  })

  /** Seed a v1-style internal row (contentHash NULL) plus its physical blob. */
  async function seedInternal(id: string, ext: string, bytes: Uint8Array): Promise<void> {
    await writeFile(path.join(filesDir, `${id}.${ext}`), bytes)
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: id.slice(-4),
      ext,
      size: bytes.length,
      contentHash: null,
      externalPath: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    })
  }

  it('backfills contentHash for every NULL internal entry (xxh3-64 of the blob)', async () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([4, 5, 6, 7])
    await seedInternal('019606a0-0000-7000-8000-0000000000e1', 'bin', a)
    await seedInternal('019606a0-0000-7000-8000-0000000000e2', 'bin', b)

    const result = await contentHashBackfillJobHandler.execute(makeCtx())
    expect(result).toEqual({ total: 2, hashed: 2, skippedOrphan: 0, failedIo: 0 })

    const e1 = await fileEntryService.getById('019606a0-0000-7000-8000-0000000000e1')
    const e2 = await fileEntryService.getById('019606a0-0000-7000-8000-0000000000e2')
    if (e1.origin !== 'internal' || e2.origin !== 'internal') throw new Error('expected internal entries')
    expect(e1.contentHash).toBe(hashContent(a))
    expect(e2.contentHash).toBe(hashContent(b))
    // NULL set drained.
    expect(await fileEntryService.countInternalMissingContentHash()).toBe(0)
  })

  it('classifies an entry whose physical blob is missing as skippedOrphan (ENOENT) and leaves it NULL', async () => {
    const id = '019606a0-0000-7000-8000-0000000000e3'
    const now = Date.now()
    // Row only — no physical file → fsHash throws ENOENT → skippedOrphan.
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'orphan',
      ext: 'bin',
      size: 3,
      contentHash: null,
      externalPath: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    })

    const result = await contentHashBackfillJobHandler.execute(makeCtx())
    expect(result).toEqual({ total: 1, hashed: 0, skippedOrphan: 1, failedIo: 0 })

    const e = await fileEntryService.getById(id)
    if (e.origin !== 'internal') throw new Error('expected internal entry')
    expect(e.contentHash).toBeNull()
  })

  it('classifies a non-ENOENT hash failure as failedIo (blob path is a directory → EISDIR), leaves it NULL, still completes', async () => {
    const id = '019606a0-0000-7000-8000-0000000000e5'
    const now = Date.now()
    // Place a DIRECTORY where the physical blob is expected. createReadStream
    // then fails with EISDIR (not ENOENT) → must land in failedIo, not orphan.
    await mkdir(path.join(filesDir, `${id}.bin`), { recursive: true })
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'isdir',
      ext: 'bin',
      size: 3,
      contentHash: null,
      externalPath: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    })

    const ctx = makeCtx()
    const result = await contentHashBackfillJobHandler.execute(ctx)
    expect(result).toEqual({ total: 1, hashed: 0, skippedOrphan: 0, failedIo: 1 })
    // Surfaced as an error (real IO failure), not a quiet orphan warn.
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('blob hash failed (IO/permission)'),
      expect.objectContaining({ id, code: 'EISDIR' })
    )

    const e = await fileEntryService.getById(id)
    if (e.origin !== 'internal') throw new Error('expected internal entry')
    expect(e.contentHash).toBeNull()
  })

  it('treats a concurrent-delete (NOT_FOUND on persist) as a benign skippedOrphan, never failedIo', async () => {
    const id = '019606a0-0000-7000-8000-0000000000e6'
    await seedInternal(id, 'bin', new Uint8Array([1, 1, 2]))
    // Blob hashes fine, but the row is trashed/permanently-deleted between the
    // keyset page and the update → update() throws NOT_FOUND. This must be a
    // benign skip with a distinct warn, NOT an `error`-level failedIo.
    vi.spyOn(fileEntryService, 'update').mockRejectedValueOnce(DataApiErrorFactory.notFound('FileEntry', id))

    const ctx = makeCtx()
    const result = await contentHashBackfillJobHandler.execute(ctx)
    expect(result).toEqual({ total: 1, hashed: 0, skippedOrphan: 1, failedIo: 0 })
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('vanished before persist'),
      expect.objectContaining({ id })
    )
    expect(ctx.logger.error).not.toHaveBeenCalled()
  })

  it('rethrows an unexpected persist error (SQLITE_BUSY) so the job fails instead of hiding it as failedIo', async () => {
    const id = '019606a0-0000-7000-8000-0000000000e7'
    await seedInternal(id, 'bin', new Uint8Array([3, 3, 3]))
    // A non-DataApiError persist failure (DB contention, a bug) is unexpected:
    // it must propagate out of execute() (failed job), not be swallowed.
    const boom = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
    vi.spyOn(fileEntryService, 'update').mockRejectedValueOnce(boom)

    await expect(contentHashBackfillJobHandler.execute(makeCtx())).rejects.toThrow(/database is locked/)
    // Row stays NULL — it'll be retried on the next backfill run.
    expect(await fileEntryService.countInternalMissingContentHash()).toBe(1)
  })

  it('is a no-op when no internal entry is missing a contentHash', async () => {
    const result = await contentHashBackfillJobHandler.execute(makeCtx())
    expect(result).toEqual({ total: 0, hashed: 0, skippedOrphan: 0, failedIo: 0 })
  })

  it('aborts promptly when the signal is already aborted', async () => {
    await seedInternal('019606a0-0000-7000-8000-0000000000e4', 'bin', new Uint8Array([9]))
    const aborted = AbortSignal.abort()
    await expect(contentHashBackfillJobHandler.execute(makeCtx(aborted))).rejects.toThrow(/abort/i)
    // The pending row is untouched (still NULL).
    expect(await fileEntryService.countInternalMissingContentHash()).toBe(1)
  })
})
