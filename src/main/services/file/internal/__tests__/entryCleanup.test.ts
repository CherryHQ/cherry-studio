import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable, paintingFileRefTable } from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { paintingTable } from '@data/db/schemas/painting'
import { topicTable } from '@data/db/schemas/topic'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { loggerService } from '@logger'
import type { CleanupPolicy, FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { danglingCache } from '../../danglingCache'
import { canonicalizeExternalPath } from '../../utils/pathResolver'
import { createVersionCacheImpl } from '../../versionCache'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { ENTRY_CLEANUP_BATCH_LIMIT, runEntryCleanup, summariseEntryCleanup } = await import('../entryCleanup')

const HOUR = 60 * 60 * 1000

function nthId(i: number): FileEntryId {
  return `019606a0-0000-7000-8000-${String(i).padStart(12, '0')}`
}

function makeDeps() {
  return {
    fileEntryService,
    fileRefService,
    danglingCache,
    versionCache: createVersionCacheImpl(10)
  }
}

describe('entryCleanup', () => {
  const dbh = setupTestDatabase()
  let filesDir: string

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    MockMainCacheServiceUtils.resetMocks()
    filesDir = await mkdtemp(path.join(tmpdir(), 'cherry-fm-entrycleanup-'))
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(filesDir, filename) : filesDir
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(filesDir, { recursive: true, force: true })
  })

  async function seedInternal(
    id: FileEntryId,
    policy: CleanupPolicy,
    opts: { ageMs?: number; deletedAt?: number | null; withBlob?: boolean } = {}
  ): Promise<void> {
    const ts = Date.now() - (opts.ageMs ?? 2 * HOUR)
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'e',
      ext: 'txt',
      size: 1,
      externalPath: null,
      cleanupPolicy: policy,
      deletedAt: opts.deletedAt ?? null,
      createdAt: ts,
      updatedAt: ts
    })
    if (opts.withBlob !== false) await writeFile(path.join(filesDir, `${id}.txt`), 'x')
  }

  async function seedRef(fileEntryId: FileEntryId): Promise<void> {
    const now = Date.now()
    const paintingId = '11111111-1111-4111-8111-' + fileEntryId.slice(-12)
    await dbh.db.insert(paintingTable).values({
      id: paintingId,
      providerId: 'provider',
      modelId: null,
      prompt: 'prompt',
      orderKey: paintingId,
      createdAt: now,
      updatedAt: now
    })
    await dbh.db.insert(paintingFileRefTable).values({
      id: '22222222-2222-4222-8222-' + fileEntryId.slice(-12),
      fileEntryId,
      sourceId: paintingId,
      role: 'output',
      createdAt: now,
      updatedAt: now
    })
  }

  async function seedChatRef(fileEntryId: FileEntryId): Promise<{ topicId: string }> {
    const now = Date.now()
    const suffix = fileEntryId.slice(-12)
    const topicId = `topic-${suffix}`
    const rootId = `root-${suffix}`
    const messageId = `message-${suffix}`
    await dbh.db.insert(topicTable).values({ id: topicId, activeNodeId: messageId, orderKey: topicId })
    await dbh.db.insert(messageTable).values([
      {
        id: rootId,
        parentId: null,
        topicId,
        role: 'root',
        data: { parts: [] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: now,
        updatedAt: now
      },
      {
        id: messageId,
        parentId: rootId,
        topicId,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: now,
        updatedAt: now
      }
    ])
    await dbh.db.insert(chatMessageFileRefTable).values({
      id: `33333333-3333-4333-8333-${suffix}`,
      fileEntryId,
      sourceId: messageId,
      role: 'attachment',
      createdAt: now,
      updatedAt: now
    })
    return { topicId }
  }

  it('reclaims an auto zero-ref entry past grace: row deleted, blob unlinked', async () => {
    const id = nthId(1)
    await seedInternal(id, 'delete_when_unreferenced')
    const report = await runEntryCleanup(makeDeps())
    expect(report.outcome).toBe('completed')
    expect(report.deleted).toBe(1)
    expect(fileEntryService.findById(id)).toBeNull()
    await expect(stat(path.join(filesDir, `${id}.txt`))).rejects.toThrow(/ENOENT/)
  })

  it('preserves manual zero-ref entries', async () => {
    const id = nthId(2)
    await seedInternal(id, 'manual')
    const report = await runEntryCleanup(makeDeps())
    expect(report.deleted).toBe(0)
    expect(fileEntryService.findById(id)).not.toBeNull()
  })

  it('preserves entries with a persistent ref', async () => {
    const id = nthId(3)
    await seedInternal(id, 'delete_when_unreferenced')
    await seedRef(id)
    const report = await runEntryCleanup(makeDeps())
    expect(report.deleted).toBe(0)
    expect(fileEntryService.findById(id)).not.toBeNull()
  })

  it('skips entries younger than grace', async () => {
    const id = nthId(4)
    await seedInternal(id, 'delete_when_unreferenced', { ageMs: 0 })
    const report = await runEntryCleanup(makeDeps())
    expect(report.candidates).toBe(0)
    expect(report.deleted).toBe(0)
    expect(fileEntryService.findById(id)).not.toBeNull()
  })

  it('reclaims trashed auto entries', async () => {
    const id = nthId(5)
    await seedInternal(id, 'delete_when_unreferenced', { deletedAt: Date.now() })
    const report = await runEntryCleanup(makeDeps())
    expect(report.deleted).toBe(1)
    expect(fileEntryService.findById(id)).toBeNull()
  })

  it('reclaims external auto entries DB-only, leaving the on-disk file untouched', async () => {
    const id = nthId(6)
    const externalDir = await mkdtemp(path.join(tmpdir(), 'cherry-fm-entrycleanup-external-'))
    const realFile = path.join(externalDir, 'user-file.txt')
    await writeFile(realFile, 'user data')
    const externalPath = canonicalizeExternalPath(realFile)
    const ts = Date.now() - 2 * HOUR
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'external',
      name: 'ext',
      ext: 'txt',
      size: null,
      externalPath,
      cleanupPolicy: 'delete_when_unreferenced',
      deletedAt: null,
      createdAt: ts,
      updatedAt: ts
    })

    const report = await runEntryCleanup(makeDeps())

    expect(report.deleted).toBe(1)
    expect(fileEntryService.findById(id)).toBeNull()
    // The user's on-disk file must never be touched for external entries —
    // cleanup here is DB-only.
    await expect(stat(realFile)).resolves.toBeDefined()

    await rm(externalDir, { recursive: true, force: true })
  })

  it('skips entries holding a temp-session ref and counts skippedTempRefs', async () => {
    const id = nthId(7)
    await seedInternal(id, 'delete_when_unreferenced')
    fileRefService.createTempSessionRef({ fileEntryId: id, sourceId: 'session-1', role: 'pending' })
    const report = await runEntryCleanup(makeDeps())
    expect(report.skippedTempRefs).toBe(1)
    expect(fileEntryService.findById(id)).not.toBeNull()
  })

  it('counts skippedRefsReappeared when a ref lands between query and tx', async () => {
    const id = nthId(8)
    await seedInternal(id, 'delete_when_unreferenced')
    const deps = makeDeps()
    const spy = vi.spyOn(deps.fileRefService, 'countPersistentRefsByEntryIdTx').mockImplementationOnce(() => 1)
    const report = await runEntryCleanup(deps)
    expect(report.skippedRefsReappeared).toBe(1)
    expect(report.deleted).toBe(0)
    expect(fileEntryService.findById(id)).not.toBeNull()
    spy.mockRestore()
  })

  it('reclaims a large candidate set (100% of rows) — there is no volume abort', async () => {
    // Regression for the removed count-fraction abort (spec §5.3): an earlier
    // revision refused to reclaim when candidates were ≥20 and >50% of rows.
    // That false-positived on the primary legitimate case — a user deleting many
    // chats/paintings whose attachments then genuinely should be reclaimed.
    for (let i = 0; i < 25; i++) await seedInternal(nthId(100 + i), 'delete_when_unreferenced')
    const report = await runEntryCleanup(makeDeps())
    expect(report.outcome).toBe('completed')
    expect(report.deleted).toBe(25)
    expect(fileEntryService.countAll()).toBe(0)
  })

  it('counts gonePinned when the tx re-read finds the row gone (or pinned) mid-flight', async () => {
    const id = nthId(13)
    await seedInternal(id, 'delete_when_unreferenced')
    const deps = makeDeps()
    // Row vanished (or was pinned to manual) between the candidate query and the
    // serialized re-read → gone-or-pinned, no delete, no data loss.
    const spy = vi.spyOn(deps.fileEntryService, 'findByIdTx').mockImplementationOnce(() => null)
    const report = await runEntryCleanup(deps)
    expect(report.gonePinned).toBe(1)
    expect(report.deleted).toBe(0)
    expect(fileEntryService.findById(id)).not.toBeNull()
    spy.mockRestore()
  })

  it('counts failed and preserves the entry when a candidate throws (retried next pass)', async () => {
    const id = nthId(14)
    await seedInternal(id, 'delete_when_unreferenced')
    const deps = makeDeps()
    const spy = vi.spyOn(deps.fileEntryService, 'withWriteTx').mockImplementationOnce(() => {
      throw new Error('tx boom')
    })
    const report = await runEntryCleanup(deps)
    expect(report.failed).toBe(1)
    expect(report.deleted).toBe(0)
    expect(fileEntryService.findById(id)).not.toBeNull()
    spy.mockRestore()
  })

  it('reports failed with the raw error (stack) logged when the pass throws before the loop', async () => {
    const deps = makeDeps()
    const spy = vi.spyOn(deps.fileEntryService, 'countCleanupCandidates').mockImplementation(() => {
      throw new Error('db exploded')
    })
    const errorSpy = vi.spyOn(loggerService, 'error')
    const report = await runEntryCleanup(deps)
    expect(report.outcome).toBe('failed')
    expect(report.errorMessage).toBe('db exploded')
    // The raw Error is passed first (stack preserved), not just its message string.
    expect(errorSpy).toHaveBeenCalledWith(
      'file-entry-cleanup',
      expect.any(Error),
      expect.objectContaining({ event: 'file-entry-cleanup', outcome: 'failed' })
    )
    spy.mockRestore()
  })

  it('respects the batch limit and reports total candidates', async () => {
    expect(ENTRY_CLEANUP_BATCH_LIMIT).toBe(100)
    for (let i = 0; i < 5; i++) await seedInternal(nthId(200 + i), 'delete_when_unreferenced')
    const report = await runEntryCleanup(makeDeps())
    expect(report.candidates).toBe(5)
    expect(report.deleted).toBe(5)
  })

  it('deleting a topic cascades refs and the pass then reclaims the attachment (integration)', async () => {
    const id = nthId(9)
    await seedInternal(id, 'delete_when_unreferenced')
    const { topicId } = await seedChatRef(id)
    await dbh.db.delete(topicTable).where(eq(topicTable.id, topicId))
    const report = await runEntryCleanup(makeDeps())
    expect(report.deleted).toBe(1)
    expect(fileEntryService.findById(id)).toBeNull()
  })

  it('emits the file-entry-cleanup structured log', async () => {
    const id = nthId(10)
    await seedInternal(id, 'delete_when_unreferenced')
    const infoSpy = vi.spyOn(loggerService, 'info')
    await runEntryCleanup(makeDeps())
    expect(infoSpy).toHaveBeenCalledWith(
      'file-entry-cleanup',
      expect.objectContaining({ event: 'file-entry-cleanup', outcome: 'completed' })
    )
  })

  describe('summariseEntryCleanup', () => {
    it('projects the narrow wire summary from a full report', async () => {
      const id = nthId(11)
      await seedInternal(id, 'delete_when_unreferenced')
      const report = await runEntryCleanup(makeDeps())
      const summary = summariseEntryCleanup(report)
      expect(summary).toEqual({ outcome: 'completed', candidates: report.candidates, deleted: report.deleted })
    })
  })
})
