import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import type { JobContext } from '@main/core/job/types'
import * as fileUtils from '@main/utils/file'
import { hashContent } from '@main/utils/file'
import type { FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { application } = await import('@application')
const { fileEntryService } = await import('@data/services/FileEntryService')
const { fileRefService } = await import('@data/services/FileRefService')
const { fileEntryTable } = await import('@data/db/schemas/file')
const backfillModule = await import('../contentHashBackfillJobHandler')
const { createContentHashBackfillJobHandler } = backfillModule
const { write } = await import('../../internal/content/write')

import type { FileManagerDeps } from '../../internal/deps'

function makeCtx(signal: AbortSignal = new AbortController().signal): JobContext<Record<string, never>> {
  return {
    jobId: 'content-hash-backfill-test',
    input: {},
    attempt: 0,
    parentId: null,
    signal,
    metadata: {},
    patchMetadata: vi.fn().mockResolvedValue(undefined),
    reportProgress: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  } as unknown as JobContext<Record<string, never>>
}

describe('contentHashBackfillJobHandler', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let filesDir: string
  let deps: FileManagerDeps
  let contentHashBackfillJobHandler: ReturnType<typeof createContentHashBackfillJobHandler>

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-content-hash-backfill-'))
    filesDir = path.join(tmp, 'Files')
    await mkdir(filesDir, { recursive: true })
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') return filename ? path.join(filesDir, filename) : filesDir
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    deps = {
      fileEntryService,
      fileRefService,
      danglingCache: {} as FileManagerDeps['danglingCache'],
      versionCache: { get: vi.fn(), set: vi.fn(), invalidate: vi.fn(), clear: vi.fn() },
      contentWriteLock: new KeyedMutex()
    }
    contentHashBackfillJobHandler = createContentHashBackfillJobHandler(deps)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tmp, { recursive: true, force: true })
  })

  async function seedInternal(id: FileEntryId, bytes: Uint8Array, deletedAt: number | null = null): Promise<void> {
    await writeFile(path.join(filesDir, `${id}.bin`), bytes)
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: id.slice(-4),
      ext: 'bin',
      size: bytes.length,
      contentHash: null,
      externalPath: null,
      deletedAt,
      createdAt: now,
      updatedAt: now
    })
  }

  it('declares singleton recovery, serial execution, and a 30-minute timeout', () => {
    expect(contentHashBackfillJobHandler).toMatchObject({
      recovery: 'singleton',
      defaultConcurrency: 1,
      defaultTimeoutMs: 30 * 60_000
    })
  })

  it('reports a completed empty summary and progress 100 when there is no work', async () => {
    const ctx = makeCtx()
    await expect(contentHashBackfillJobHandler.execute(ctx)).resolves.toEqual({
      total: 0,
      hashed: 0,
      skippedOrphan: 0,
      failedIo: 0
    })
    expect(ctx.reportProgress).toHaveBeenLastCalledWith(100, expect.objectContaining({ stage: 'done', total: 0 }))
  })

  it('rebuilds size and hash from one read without changing updatedAt', async () => {
    const id = '019606a0-0000-7000-8000-000000000300' as FileEntryId
    const bytes = new Uint8Array([1, 2, 3, 4])
    await seedInternal(id, bytes)
    const preservedUpdatedAt = 1234
    await dbh.db
      .update(fileEntryTable)
      .set({ size: 99, updatedAt: preservedUpdatedAt })
      .where(eq(fileEntryTable.id, id))

    await expect(contentHashBackfillJobHandler.execute(makeCtx())).resolves.toMatchObject({ hashed: 1 })
    expect(fileEntryService.getById(id)).toMatchObject({
      size: bytes.length,
      contentHash: hashContent(bytes),
      updatedAt: preservedUpdatedAt
    })
  })

  it('drains more than one 200-row keyset page and ends progress at 100', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => {
      const id = `019606a0-0000-7000-8000-${String(index + 1).padStart(12, '0')}`
      return { id, bytes: new Uint8Array([index % 256]) }
    })
    await Promise.all(rows.map(({ id, bytes }) => seedInternal(id, bytes, id === rows[200].id ? Date.now() : null)))
    const pageSpy = vi.spyOn(fileEntryService, 'findInternalMissingContentHash')
    const ctx = makeCtx()

    await expect(contentHashBackfillJobHandler.execute(ctx)).resolves.toEqual({
      total: 201,
      hashed: 201,
      skippedOrphan: 0,
      failedIo: 0
    })

    expect(pageSpy).toHaveBeenNthCalledWith(1, null, 200)
    expect(pageSpy).toHaveBeenNthCalledWith(2, rows[199].id, 200)
    expect(pageSpy).toHaveBeenNthCalledWith(3, rows[200].id, 200)
    expect(ctx.reportProgress).toHaveBeenLastCalledWith(100, expect.objectContaining({ stage: 'done', hashed: 201 }))
  })

  it.each(['ENOENT', 'ENOTDIR'])('classifies %s hash failures as skipped orphans', async (code) => {
    const id = '019606a0-0000-7000-8000-000000000301' as FileEntryId
    await seedInternal(id, new Uint8Array([1]))
    vi.spyOn(fileUtils, 'hashWithSize').mockRejectedValueOnce(Object.assign(new Error(code), { code }))
    const ctx = makeCtx()

    await expect(contentHashBackfillJobHandler.execute(ctx)).resolves.toEqual({
      total: 1,
      hashed: 0,
      skippedOrphan: 1,
      failedIo: 0
    })
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('skipped orphan'),
      expect.objectContaining({ id, code })
    )
  })

  it('classifies other hash errors as failed IO and continues', async () => {
    const id = '019606a0-0000-7000-8000-000000000302' as FileEntryId
    await seedInternal(id, new Uint8Array([2]))
    vi.spyOn(fileUtils, 'hashWithSize').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    const ctx = makeCtx()

    await expect(contentHashBackfillJobHandler.execute(ctx)).resolves.toEqual({
      total: 1,
      hashed: 0,
      skippedOrphan: 0,
      failedIo: 1
    })
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('blob hash failed'),
      expect.objectContaining({ id, code: 'EACCES' })
    )
  })

  it('treats a concurrent delete before persist as a skipped orphan', async () => {
    const id = '019606a0-0000-7000-8000-000000000303' as FileEntryId
    await seedInternal(id, new Uint8Array([3]))
    vi.spyOn(fileEntryService, 'repairInternalContentMetadataIfUnknown').mockImplementationOnce(() => {
      fileEntryService.delete(id)
      return false
    })

    await expect(contentHashBackfillJobHandler.execute(makeCtx())).resolves.toEqual({
      total: 1,
      hashed: 0,
      skippedOrphan: 1,
      failedIo: 0
    })
  })

  it('rethrows arbitrary DB persist failures', async () => {
    const id = '019606a0-0000-7000-8000-000000000304' as FileEntryId
    await seedInternal(id, new Uint8Array([4]))
    vi.spyOn(fileEntryService, 'repairInternalContentMetadataIfUnknown').mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY')
    })

    await expect(contentHashBackfillJobHandler.execute(makeCtx())).rejects.toThrow('SQLITE_BUSY')
  })

  it('propagates an already-aborted signal without touching pending rows', async () => {
    const id = '019606a0-0000-7000-8000-000000000305' as FileEntryId
    await seedInternal(id, new Uint8Array([5]))
    await expect(contentHashBackfillJobHandler.execute(makeCtx(AbortSignal.abort()))).rejects.toThrow(/abort/i)
    expect(fileEntryService.countInternalMissingContentHash()).toBe(1)
  })

  it('interrupts an in-flight hash on abort without persisting the row', async () => {
    const id = '019606a0-0000-7000-8000-000000000306' as FileEntryId
    await seedInternal(id, new Uint8Array([6]))
    const controller = new AbortController()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    vi.spyOn(fileUtils, 'hashWithSize').mockImplementationOnce((_path, signal) => {
      markStarted()
      if (!signal) return Promise.reject(new Error('missing abort signal'))
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const updateSpy = vi.spyOn(fileEntryService, 'repairInternalContentMetadataIfUnknown')
    const execution = contentHashBackfillJobHandler.execute(makeCtx(controller.signal))

    await started
    controller.abort(new DOMException('hash cancelled', 'AbortError'))

    await expect(execution).rejects.toThrow('hash cancelled')
    expect(updateSpy).not.toHaveBeenCalled()
    expect(fileEntryService.countInternalMissingContentHash()).toBe(1)
  })

  it('serialises backfill with a foreground write so DB hash matches the final blob', async () => {
    const id = '019606a0-0000-7000-8000-000000000307' as FileEntryId
    const oldBytes = new Uint8Array([0x01])
    const newBytes = new Uint8Array([0x02, 0x03])
    await seedInternal(id, oldBytes)
    const handler = createContentHashBackfillJobHandler(deps)

    let hashRead!: () => void
    const hashHasReadOldBytes = new Promise<void>((resolve) => {
      hashRead = resolve
    })
    let continueHash!: () => void
    const hashGate = new Promise<void>((resolve) => {
      continueHash = resolve
    })
    const realHashWithSize = fileUtils.hashWithSize
    vi.spyOn(fileUtils, 'hashWithSize').mockImplementationOnce(async (file, signal) => {
      const oldMetadata = await realHashWithSize(file, signal)
      hashRead()
      await hashGate
      return oldMetadata
    })

    const backfill = handler.execute(makeCtx())
    await hashHasReadOldBytes
    const foreground = write(deps, id, newBytes)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(Array.from(await readFile(path.join(filesDir, `${id}.bin`)))).toEqual(Array.from(oldBytes))

    continueHash()
    await backfill
    await foreground

    expect(Array.from(await readFile(path.join(filesDir, `${id}.bin`)))).toEqual(Array.from(newBytes))
    expect(fileEntryService.getById(id)).toMatchObject({ contentHash: hashContent(newBytes) })
  })
})
