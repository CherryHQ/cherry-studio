import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
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
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import type { CleanupPolicy, FileEntryId } from '@shared/data/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { canonicalizeFilePath } from '@shared/utils/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { danglingCache } from '../../danglingCache'
import { createVersionCacheImpl } from '../../versionCache'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// The scan-based cleanup gates on a pending staged restore, like the orphan sweeps.
const hasPendingRestoreMock = vi.fn((): boolean => false)
vi.mock('@data/db/restore/restoreGuard', () => ({
  hasPendingRestore: () => hasPendingRestoreMock()
}))

const { ENTRY_CLEANUP_BATCH_LIMIT, ENTRY_CLEANUP_GRACE_MS, runEntryCleanup, summariseEntryCleanup } = await import(
  '../entryCleanup'
)

const HOUR = 60 * 60 * 1000

function nthId(i: number): FileEntryId {
  return `019606a0-0000-7000-8000-${String(i).padStart(12, '0')}`
}

function makeDeps() {
  return {
    fileEntryService,
    fileRefService,
    danglingCache,
    versionCache: createVersionCacheImpl(10),
    contentWriteLock: new KeyedMutex()
  }
}

describe('entryCleanup', () => {
  const dbh = setupTestDatabase()
  let filesDir: string

  beforeEach(async () => {
    hasPendingRestoreMock.mockReturnValue(false)
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

  it('skips the pass and reports skipped when a staged restore is pending, leaving candidates untouched', async () => {
    hasPendingRestoreMock.mockReturnValue(true)
    const id = nthId(1)
    await seedInternal(id, 'delete_when_unreferenced')
    const report = await runEntryCleanup(makeDeps())
    expect(report.outcome).toBe('skipped')
    expect(report.deleted).toBe(0)
    // An otherwise-eligible auto zero-ref candidate survives because the pass stood aside.
    expect(fileEntryService.findById(id)).not.toBeNull()
    expect(summariseEntryCleanup(report).outcome).toBe('skipped')
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

  it('brackets the grace boundary: just inside is preserved, just outside is reclaimed', async () => {
    // `ageMs: 0` only proves "very young"; it would still pass if the window
    // were minutes instead of an hour. Bracket ENTRY_CLEANUP_GRACE_MS itself so
    // a wrong constant or a flipped comparison shows up. Exact equality is not
    // testable without a fake clock — real time advances between seeding and the
    // pass, which would carry an exactly-on-boundary row over the line — so both
    // sides carry a minute of slack.
    const insideGrace = nthId(40)
    const pastGrace = nthId(41)
    await seedInternal(insideGrace, 'delete_when_unreferenced', { ageMs: ENTRY_CLEANUP_GRACE_MS - 60_000 })
    await seedInternal(pastGrace, 'delete_when_unreferenced', { ageMs: ENTRY_CLEANUP_GRACE_MS + 60_000 })

    const report = await runEntryCleanup(makeDeps())

    expect(report.deleted).toBe(1)
    expect(fileEntryService.findById(insideGrace)).not.toBeNull()
    expect(fileEntryService.findById(pastGrace)).toBeNull()
  })

  it('counts unlinkFailures but still deletes the row, keeping DB and FS converged', async () => {
    // A blob whose unlink genuinely fails must not hold the row hostage: the row
    // is the source of truth and a stranded blob is reclaimable later by the FS
    // orphan sweep, whereas keeping the row would retry the same failing unlink
    // on every pass forever. Provoke a real failure rather than mocking one —
    // `remove()` only swallows ENOENT, and unlinking a directory raises
    // EPERM (macOS) / EISDIR (Linux).
    const id = nthId(42)
    await seedInternal(id, 'delete_when_unreferenced', { withBlob: false })
    await mkdir(path.join(filesDir, `${id}.txt`))

    const report = await runEntryCleanup(makeDeps())

    expect(report.unlinkFailures).toBe(1)
    expect(report.deleted).toBe(1)
    expect(fileEntryService.findById(id)).toBeNull()
  })

  it('leaves the entry alone when the tx re-read finds it pinned to manual mid-flight', async () => {
    // The other half of gone-or-pinned: the row is still there, but its policy
    // was upgraded to `manual` between the candidate query and the serialized
    // re-read (e.g. ensureExternal pinning a library file). Only the `null`
    // half was covered by a mock; this drives the real re-read.
    const id = nthId(43)
    await seedInternal(id, 'delete_when_unreferenced')
    const deps = makeDeps()
    const original = deps.fileEntryService.findByIdTx.bind(deps.fileEntryService)
    const spy = vi.spyOn(deps.fileEntryService, 'findByIdTx').mockImplementationOnce((tx, entryId) => {
      const row = original(tx, entryId)
      return row && { ...row, cleanupPolicy: 'manual' as const }
    })

    const report = await runEntryCleanup(deps)

    spy.mockRestore()
    expect(report.gonePinned).toBe(1)
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
    const externalPath = canonicalizeFilePath(AbsoluteFilePathSchema.parse(realFile))
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
    expect(dbh.db.select().from(fileEntryTable).all()).toHaveLength(0)
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
    const spy = vi.spyOn(deps.fileEntryService, 'findCleanupCandidates').mockImplementation(() => {
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

  it('reports the candidates this pass picked up', async () => {
    expect(ENTRY_CLEANUP_BATCH_LIMIT).toBe(100)
    for (let i = 0; i < 5; i++) await seedInternal(nthId(200 + i), 'delete_when_unreferenced')
    const report = await runEntryCleanup(makeDeps())
    expect(report.candidates).toBe(5)
    expect(report.deleted).toBe(5)
  })

  it('saturates candidates at the batch limit and drains the rest on the next pass', async () => {
    // `candidates` is the batch size, not the backlog: the pass runs the
    // anti-join once and reports what it got. A saturated batch is the only
    // backlog signal in the log line, so it must be exact — and the leftovers
    // must still be reclaimed rather than stranded.
    const total = ENTRY_CLEANUP_BATCH_LIMIT + 5
    for (let i = 0; i < total; i++) await seedInternal(nthId(3000 + i), 'delete_when_unreferenced')

    const first = await runEntryCleanup(makeDeps())
    expect(first.candidates).toBe(ENTRY_CLEANUP_BATCH_LIMIT)
    expect(first.deleted).toBe(ENTRY_CLEANUP_BATCH_LIMIT)

    const second = await runEntryCleanup(makeDeps())
    expect(second.candidates).toBe(5)
    expect(second.deleted).toBe(5)
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
