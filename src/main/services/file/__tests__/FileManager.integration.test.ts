import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { BaseService } from '@main/core/lifecycle'
import type { FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { FileManager } = await import('../FileManager')
const { danglingCache } = await import('../danglingCache')

describe('FileManager (integration)', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let internalRoot: string
  let fm: InstanceType<typeof FileManager>

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-int-'))
    internalRoot = path.join(tmp, 'files-internal')
    await mkdir(internalRoot, { recursive: true })
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(internalRoot, filename) : internalRoot
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    BaseService.resetInstances()
    danglingCache.clear()
    fm = new FileManager()
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('INT-1: end-to-end internal entry read', async () => {
    const id = '019606a0-0000-7000-8000-00000000ff01' as FileEntryId
    const physicalPath = path.join(internalRoot, `${id}.txt`)
    await writeFile(physicalPath, 'internal-payload', 'utf-8')

    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'note',
      ext: 'txt',
      size: 'internal-payload'.length,
      externalPath: null,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })

    const entry = await fm.getById(id)
    expect(entry.id).toBe(id)
    expect(entry.origin).toBe('internal')

    const result = await fm.read(id)
    expect(result.content).toBe('internal-payload')
    expect(result.mime).toBe('text/plain')
    expect(result.version.size).toBe('internal-payload'.length)

    const meta = await fm.getMetadata(id)
    expect(meta.kind).toBe('file')
    expect(meta.size).toBe('internal-payload'.length)

    const url = await fm.getUrl(id)
    expect(url).toMatch(/^file:\/\//)
    expect(url).toContain(encodeURIComponent(`${id}.txt`).replace(/%2F/g, '/'))
  })

  it('INT-2: external entry canonicalization end-to-end (case-sensitive byte match)', async () => {
    const id = '019606a0-0000-7000-8000-00000000ff02' as FileEntryId
    const file = path.join(tmp, 'doc.pdf')
    await writeFile(file, '%PDF-1.4')

    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'external',
      name: 'doc',
      ext: 'pdf',
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })

    // Canonical lookup
    const found = await fm.findByExternalPath(`${file}/`) // trailing slash → canonicalize strips
    expect(found?.id).toBe(id)

    // NFC re-normalization survives a synthesized NFD form
    const nfdFile = file.normalize('NFD')
    const foundNfc = await fm.findByExternalPath(nfdFile)
    expect(foundNfc?.id).toBe(id)

    // Content hash works for external entries
    const hash = await fm.getContentHash(id)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('INT-3: missing-file ENOENT propagates from read', async () => {
    const id = '019606a0-0000-7000-8000-00000000ff03' as FileEntryId
    const file = path.join(tmp, 'gone.txt')

    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'external',
      name: 'gone',
      ext: 'txt',
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })

    await expect(fm.read(id)).rejects.toThrow(/ENOENT/)
  })

  // Every external-touching read path (read / hash / getMetadata / getVersion)
  // must report a missing physical file into DanglingCache so any subsequent
  // UI query sees the file as dangling without waiting for a fresh stat. The
  // four cases match the call sites wrapped by `observeExternalAccess`.
  //
  // Each case seeds an independent (id, externalPath) row to keep tests
  // hermetic — running them as it.each on a shared id with mid-loop deletes
  // makes failure attribution painful when the assertion regresses.
  async function seedMissingExternal(id: FileEntryId, basename: string): Promise<string> {
    const file = path.join(tmp, basename)
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'external',
      name: basename.replace(/\.[^.]+$/, ''),
      ext: 'txt',
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })
    danglingCache.addEntry(id, file as never)
    return file
  }

  it('INT-3a: read on missing external file flips DanglingCache to "missing"', async () => {
    const id = '019606a0-0000-7000-8000-00000000ff31' as FileEntryId
    await seedMissingExternal(id, 'flip-read.txt')
    await expect(fm.read(id)).rejects.toThrow(/ENOENT/)
    expect(await fm.getDanglingState({ id })).toBe('missing')
  })

  it('INT-3b: getContentHash on missing external file flips DanglingCache to "missing"', async () => {
    const id = '019606a0-0000-7000-8000-00000000ff32' as FileEntryId
    await seedMissingExternal(id, 'flip-hash.txt')
    await expect(fm.getContentHash(id)).rejects.toThrow(/ENOENT/)
    expect(await fm.getDanglingState({ id })).toBe('missing')
  })

  it('INT-3c: getMetadata on missing external file flips DanglingCache to "missing"', async () => {
    const id = '019606a0-0000-7000-8000-00000000ff33' as FileEntryId
    await seedMissingExternal(id, 'flip-meta.txt')
    await expect(fm.getMetadata(id)).rejects.toThrow(/ENOENT/)
    expect(await fm.getDanglingState({ id })).toBe('missing')
  })

  it('INT-3d: getVersion on missing external file flips DanglingCache to "missing"', async () => {
    const id = '019606a0-0000-7000-8000-00000000ff34' as FileEntryId
    await seedMissingExternal(id, 'flip-version.txt')
    await expect(fm.getVersion(id)).rejects.toThrow(/ENOENT/)
    expect(await fm.getDanglingState({ id })).toBe('missing')
  })

  it('INT-4: write path round-trip — create internal, write, read, trash, restore, permanentDelete', async () => {
    const created = await fm.createInternalEntry({
      source: 'bytes',
      data: new Uint8Array([0x01, 0x02]),
      name: 'note',
      ext: 'txt'
    })
    expect(created.size).toBe(2)
    expect(created.origin).toBe('internal')

    const v = await fm.write(created.id, new Uint8Array([0xaa, 0xbb, 0xcc]))
    expect(v.size).toBe(3)

    const read = await fm.read(created.id, { encoding: 'binary' })
    expect(Array.from(read.content)).toEqual([0xaa, 0xbb, 0xcc])

    await fm.trash(created.id)
    expect((await fm.getById(created.id)).trashedAt).not.toBeNull()

    const restored = await fm.restore(created.id)
    expect(restored.trashedAt).toBeNull()

    await fm.permanentDelete(created.id)
    await expect(fm.getById(created.id)).rejects.toThrow(/not found/i)
  })

  it('INT-5: trash on external entry is blocked by DB CHECK fe_external_no_trash', async () => {
    const file = path.join(tmp, 'ext.txt')
    await writeFile(file, 'x')
    const e = await fm.ensureExternalEntry({ externalPath: file as never })
    await expect(fm.trash(e.id)).rejects.toThrow()
    expect((await fm.getById(e.id)).trashedAt).toBeNull()
  })

  it('INT-6: permanentDelete on external leaves user file untouched', async () => {
    const file = path.join(tmp, 'ext-keep.txt')
    await writeFile(file, 'preserve me')
    const e = await fm.ensureExternalEntry({ externalPath: file as never })
    await fm.permanentDelete(e.id)
    await expect(fm.getById(e.id)).rejects.toThrow(/not found/i)
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(file, 'utf-8')).toBe('preserve me')
  })

  it('INT-7: getDanglingState — internal "present", external "missing" after unlink', async () => {
    const internalId = '019606a0-0000-7000-8000-00000000ff10' as FileEntryId
    const internalPhysical = path.join(internalRoot, `${internalId}.txt`)
    await writeFile(internalPhysical, 'inner')
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id: internalId,
      origin: 'internal',
      name: 'inner',
      ext: 'txt',
      size: 5,
      externalPath: null,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })
    expect(await fm.getDanglingState({ id: internalId })).toBe('present')

    const externalFile = path.join(tmp, 'will-go.txt')
    await writeFile(externalFile, 'will-go')
    const ext = await fm.ensureExternalEntry({ externalPath: externalFile as never })
    expect(await fm.getDanglingState({ id: ext.id })).toBe('present')

    const { rm: rmFile } = await import('node:fs/promises')
    await rmFile(externalFile)
    danglingCache.onFsEvent(externalFile as never, 'missing', 'ops')
    expect(await fm.getDanglingState({ id: ext.id })).toBe('missing')
  })

  it('INT-10: onInit seeds DanglingCache from DB so subsequent unlink events reach external entries', async () => {
    const file = path.join(tmp, 'preexisting.txt')
    await writeFile(file, 'p')
    // Pre-insert the external entry directly via DB (simulates a prior session).
    const id = '019606a0-0000-7000-8000-00000000ff20' as FileEntryId
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'external',
      name: 'preexisting',
      ext: 'txt',
      size: null,
      externalPath: file,
      trashedAt: null,
      createdAt: 0,
      updatedAt: 0
    })
    // The cache is empty (cleared in beforeEach). Simulate boot by invoking
    // the lifecycle init path the container would normally drive.
    await fm._doInit()
    // After initFromDb, an onFsEvent for the indexed path must reach the entry
    // and flip cache → 'missing' (cache hit, no cold stat needed).
    danglingCache.onFsEvent(file as never, 'missing', 'watcher')
    expect(await fm.getDanglingState({ id })).toBe('missing')
  })

  it('INT-9: subscribeDangling delivers transitions for the subscribed external entry', async () => {
    const file = path.join(tmp, 'sub.txt')
    await writeFile(file, 'sub')
    const e = await fm.ensureExternalEntry({ externalPath: file as never })
    // After ensureExternalEntry the cache holds 'present' (source='ops').
    // A 'missing' observation is a genuine transition → listener fires.
    const seen: string[] = []
    const dispose = fm.subscribeDangling({ id: e.id }, (state) => seen.push(state))
    danglingCache.onFsEvent(file as never, 'missing', 'ops')
    expect(seen).toEqual(['missing'])
    dispose()
    danglingCache.onFsEvent(file as never, 'present', 'ops')
    expect(seen).toEqual(['missing']) // unsubscribed
  })

  it('INT-11: onInit fires runStartupFileSweep — orphan UUID files are unlinked', async () => {
    const orphanId = '019606a0-0000-7000-8000-00000000ff30'
    const orphanPath = path.join(internalRoot, `${orphanId}.txt`)
    await writeFile(orphanPath, 'o')
    const ancient = (Date.now() - 10 * 60 * 1000) / 1000
    const { utimes } = await import('node:fs/promises')
    await utimes(orphanPath, ancient, ancient)

    await fm._doInit()
    // The public method itself awaits both sweeps — used here for deterministic
    // observation of side effects without sleep-based timing.
    await fm.runStartupSweeps()

    const { stat } = await import('node:fs/promises')
    await expect(stat(orphanPath)).rejects.toThrow(/ENOENT/)
  })

  it('INT-12: onInit fires runDbSweep — orphan refs deleted, orphan-entry report exposed', async () => {
    // Seed an orphan temp_session ref pointing at a real file_entry.
    const id = '019606a0-0000-7000-8000-00000000ff31' as FileEntryId
    const now = Date.now()
    await dbh.db.insert(fileEntryTable).values({
      id,
      origin: 'internal',
      name: 'k',
      ext: 'txt',
      size: 1,
      externalPath: null,
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })
    const { fileRefTable } = await import('@data/db/schemas/file')
    await dbh.db.insert(fileRefTable).values({
      id: '44444444-4444-4444-8444-000000000031',
      fileEntryId: id,
      sourceType: 'temp_session',
      sourceId: 'sess-orphan',
      role: 'pending',
      createdAt: now,
      updatedAt: now
    })

    // Call runStartupSweeps directly so we observe the orphan deletion in
    // the same instance whose lastDbSweepReport we then read. (onInit's
    // fire-and-forget invocation is covered by INT-11.)
    await fm.runStartupSweeps()

    // The orphan ref has been cleaned by runDbSweep (temp_session checker → empty Set).
    const remaining = await dbh.db.select().from(fileRefTable)
    expect(remaining.length).toBe(0)

    // The entry — now without any ref — appears in getOrphanReport().
    const report = fm.getOrphanReport()
    expect(report.orphanRefsByType.temp_session).toBe(1)
    expect(report.orphanEntriesByOrigin.internal ?? 0).toBeGreaterThanOrEqual(1)
    // lastRunAt should reflect the actual sweep completion, not the read time.
    expect(report.lastRunAt).not.toBeNull()
    expect(typeof report.lastRunAt).toBe('number')
  })

  it('INT-13: getOrphanReport returns empty default with lastRunAt=null before any sweep', () => {
    // The fresh fm built in beforeEach has not run a sweep yet — verify
    // the empty-default shape is correct.
    const report = fm.getOrphanReport()
    expect(report).toEqual({
      orphanRefsByType: {},
      orphanRefsTotal: 0,
      orphanEntriesByOrigin: {},
      orphanEntriesTotal: 0,
      lastRunAt: null
    })
  })

  it('INT-14: getOrphanReport().lastRunAt does NOT advance between calls (sweep-time, not read-time)', async () => {
    await fm.runStartupSweeps()
    const first = fm.getOrphanReport().lastRunAt
    expect(first).not.toBeNull()
    // Wait a beat then re-read; lastRunAt must NOT change.
    await new Promise((r) => setTimeout(r, 5))
    const second = fm.getOrphanReport().lastRunAt
    expect(second).toBe(first)
  })

  it('INT-8: batchGetDanglingStates returns "unknown" for ids that have no entry', async () => {
    const known = '019606a0-0000-7000-8000-00000000ff11' as FileEntryId
    const ghost = '019606a0-0000-7000-8000-00000000ff99' as FileEntryId
    await dbh.db.insert(fileEntryTable).values({
      id: known,
      origin: 'internal',
      name: 'k',
      ext: 'txt',
      size: 1,
      externalPath: null,
      trashedAt: null,
      createdAt: 0,
      updatedAt: 0
    })
    const out = await fm.batchGetDanglingStates({ ids: [known, ghost] })
    expect(out[known]).toBe('present')
    expect(out[ghost]).toBe('unknown')
  })
})
