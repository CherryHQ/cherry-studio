import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { fileEntryService } from '@data/services/FileEntryService'
import { BaseService } from '@main/core/lifecycle'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))
vi.mock('@data/db/restore/restoreJournal', () => ({ hasPendingRestore: () => false }))

const { FileManager } = await import('../FileManager')

describe('FileManager temporary retention', () => {
  const db = setupTestDatabase()
  let root: string
  let files: InstanceType<typeof FileManager>

  beforeEach(async () => {
    BaseService.resetInstances()
    MockMainDbServiceUtils.setDb(db.db)
    root = await mkdtemp(path.join(tmpdir(), 'voice-retention-'))
    vi.mocked(application.getPath).mockImplementation((_key, filename) => (filename ? path.join(root, filename) : root))
    files = new FileManager()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reclaims later orphans when more than a batch of older entries are retained', async () => {
    const createdAt = Date.now() - 7_200_000
    const retainedIds = Array.from({ length: 101 }, () => uuidv7())
    for (const id of retainedIds) {
      fileEntryService.create({
        id,
        origin: 'internal',
        name: 'retained',
        ext: null,
        size: 0,
        cleanupPolicy: 'delete_when_unreferenced'
      })
      db.db.update(fileEntryTable).set({ createdAt }).where(eq(fileEntryTable.id, id)).run()
      files.retainTemporaryEntry(id)
    }
    const orphan = await files.createInternalEntry({
      source: 'bytes',
      data: new Uint8Array([3]),
      name: 'orphan',
      ext: 'bin',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    db.db
      .update(fileEntryTable)
      .set({ createdAt: createdAt + 1_000 })
      .where(eq(fileEntryTable.id, orphan.id))
      .run()
    const physicalPath = files.getPhysicalPath(orphan.id)

    const report = await files.runEntryCleanup()

    expect(report.deleted).toBe(1)
    expect(fileEntryService.findById(orphan.id)).toBeNull()
    await expect(access(physicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(retainedIds.every((id) => fileEntryService.findById(id) !== null)).toBe(true)
  })

  it('rechecks retention acquired after candidate discovery', async () => {
    const entry = await files.createInternalEntry({
      source: 'bytes',
      data: new Uint8Array([3]),
      name: 'in-use',
      ext: 'bin',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    db.db
      .update(fileEntryTable)
      .set({ createdAt: Date.now() - 7_200_000 })
      .where(eq(fileEntryTable.id, entry.id))
      .run()
    const discover = fileEntryService.findCleanupCandidates.bind(fileEntryService)
    const spy = vi.spyOn(fileEntryService, 'findCleanupCandidates').mockImplementationOnce((options) => {
      const candidates = discover(options)
      files.retainTemporaryEntry(entry.id)
      return candidates
    })
    try {
      const report = await files.runEntryCleanup()
      expect(report.skippedRefsReappeared).toBe(1)
      expect((await files.read(entry.id, { encoding: 'binary' })).content).toEqual(new Uint8Array([3]))
    } finally {
      spy.mockRestore()
    }
  })

  it('clears retention at stop and keeps stale disposals from releasing later consumers', async () => {
    const entry = await files.createInternalEntry({
      source: 'bytes',
      data: new Uint8Array([3]),
      name: 'restart',
      ext: 'bin',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    const abandoned = await files.createInternalEntry({
      source: 'bytes',
      data: new Uint8Array([4]),
      name: 'abandoned',
      ext: 'bin',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    db.db
      .update(fileEntryTable)
      .set({ createdAt: Date.now() - 7_200_000 })
      .where(eq(fileEntryTable.id, entry.id))
      .run()
    db.db
      .update(fileEntryTable)
      .set({ createdAt: Date.now() - 7_200_000 })
      .where(eq(fileEntryTable.id, abandoned.id))
      .run()
    const stale = files.retainTemporaryEntry(entry.id)
    files.retainTemporaryEntry(abandoned.id)
    await files._doStop()
    const current = files.retainTemporaryEntry(entry.id)
    stale.dispose()
    await files.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).not.toBeNull()
    expect(fileEntryService.findById(abandoned.id)).toBeNull()
    current.dispose()
    await files.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).toBeNull()
  })

  it('allows explicit deletion while an entry is retained', async () => {
    const entry = await files.createInternalEntry({
      source: 'bytes',
      data: new Uint8Array([3]),
      name: 'discard',
      ext: 'bin',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    const reference = files.retainTemporaryEntry(entry.id)
    const physicalPath = files.getPhysicalPath(entry.id)
    await files.permanentDelete(entry.id)
    expect(fileEntryService.findById(entry.id)).toBeNull()
    await expect(access(physicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    reference.dispose()
  })

  it('preserves live temporary content beyond grace and reclaims it after every retain is released', async () => {
    const entry = await files.createInternalEntry({
      source: 'bytes',
      data: new Uint8Array([1, 2, 3]),
      name: 'recording',
      ext: 'webm',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    db.db
      .update(fileEntryTable)
      .set({ createdAt: Date.now() - 7_200_000 })
      .where(eq(fileEntryTable.id, entry.id))
      .run()
    const first = files.retainTemporaryEntry(entry.id)
    const second = files.retainTemporaryEntry(entry.id)
    const physicalPath = files.getPhysicalPath(entry.id)
    await files.runEntryCleanup()
    expect((await files.read(entry.id, { encoding: 'binary' })).content).toEqual(new Uint8Array([1, 2, 3]))
    first.dispose()
    first.dispose()
    await files.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).not.toBeNull()
    second.dispose()
    await files.runEntryCleanup()
    expect(fileEntryService.findById(entry.id)).toBeNull()
    await expect(access(physicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects manual entries and missing IDs instead of creating a fictitious lifetime', async () => {
    const entry = await files.createInternalEntry({
      source: 'bytes',
      data: new Uint8Array([1]),
      name: 'manual',
      ext: 'txt',
      cleanupPolicy: 'manual'
    })
    expect(() => files.retainTemporaryEntry(entry.id)).toThrow()
    await files.permanentDelete(entry.id)
    expect(() => files.retainTemporaryEntry(entry.id)).toThrow()
  })
})
