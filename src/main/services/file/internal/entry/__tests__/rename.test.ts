import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { application } = await import('@application')
const { fileEntryService } = await import('@data/services/FileEntryService')
const { fileRefService } = await import('@data/services/FileRefService')
const { createDefaultOrphanCheckerRegistry } = await import('@data/services/orphan/FileRefCheckerRegistry')
const { rename } = await import('../rename')
const { createInternal, ensureExternal } = await import('../create')

import type { FileManagerDeps } from '../../deps'

describe('internal/entry/rename', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let filesDir: string
  let deps: FileManagerDeps

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-renametest-'))
    filesDir = path.join(tmp, 'Files')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(filesDir, { recursive: true })
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(filesDir, filename) : filesDir
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    deps = {
      fileEntryService,
      fileRefService,
      danglingCache: {
        check: vi.fn(),
        onFsEvent: vi.fn(),
        addEntry: vi.fn(),
        removeEntry: vi.fn(),
        initFromDb: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        onDanglingStateChanged: vi.fn(() => ({ dispose: () => {} })),
        clear: vi.fn()
      },
      versionCache: { get: vi.fn(), set: vi.fn(), invalidate: vi.fn(), clear: vi.fn() },
      orphanRegistry: createDefaultOrphanCheckerRegistry()
    }
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tmp, { recursive: true, force: true })
  })

  it('updates DB name only for internal entries (physical UUID path unchanged)', async () => {
    const created = await createInternal(deps, {
      source: 'bytes',
      data: new Uint8Array([0x01]),
      name: 'old',
      ext: 'txt'
    })
    const renamed = await rename(deps, created.id, 'new')
    expect(renamed.name).toBe('new')
    expect(renamed.ext).toBe('txt')
    // physical path is still UUID-based; the file exists at the same place
    const physical = path.join(filesDir, `${created.id}.txt`)
    const buf = await readFile(physical)
    expect(buf.length).toBe(1)
  })

  it('renames external file on disk and updates DB externalPath + name', async () => {
    const original = path.join(tmp, 'before.txt')
    await writeFile(original, 'hello')
    const entry = await ensureExternal(deps, { externalPath: original as FilePath })
    const renamed = await rename(deps, entry.id, 'after')
    expect(renamed.name).toBe('after')
    const expectedPath = path.join(tmp, 'after.txt')
    if (renamed.origin !== 'external') throw new Error('expected external entry')
    expect(renamed.externalPath).toBe(expectedPath)
    expect(await readFile(expectedPath, 'utf-8')).toBe('hello')
  })

  it('throws and leaves DB unchanged when external rename target already exists', async () => {
    const original = path.join(tmp, 'a.txt')
    const collision = path.join(tmp, 'b.txt')
    await writeFile(original, 'A')
    await writeFile(collision, 'B')
    const entry = await ensureExternal(deps, { externalPath: original as FilePath })
    await expect(rename(deps, entry.id, 'b')).rejects.toThrow()
    const stored = await fileEntryService.getById(entry.id)
    expect(stored.name).toBe('a')
    if (stored.origin !== 'external') throw new Error('expected external entry')
    expect(stored.externalPath).toBe(original)
    // Both files still exist with their original content
    expect(await readFile(original, 'utf-8')).toBe('A')
    expect(await readFile(collision, 'utf-8')).toBe('B')
  })

  it('treats NFC/NFD-equivalent names as a no-op (no fs.rename, no DB write)', async () => {
    // macOS HFS+/APFS surface filenames in NFD; renderer input is NFC.
    // path.join produces a string whose codepoints differ from the stored
    // (NFC) externalPath even though they refer to the same logical file.
    // Canonicalization on both sides must collapse this difference.
    // Explicit escape construction — relying on source-literal `é` is
    // unreliable because editors/formatters may NFC-normalize on save.
    const nfcName = 'qu\u00e9' // 'qué' — single codepoint U+00E9
    const nfdName = 'qu\u0065\u0301' // 'qué' — e + combining acute
    expect(nfcName).not.toBe(nfdName) // byte-distinct strings
    expect(nfcName.normalize('NFC')).toBe(nfdName.normalize('NFC'))

    const filePath = path.join(tmp, `${nfcName}.txt`)
    await writeFile(filePath, 'x')
    const entry = await ensureExternal(deps, { externalPath: filePath as FilePath })

    // Spy on the file module's `move` wrapper, not `node:fs/promises.rename`:
    // the latter is a Node native ESM namespace member and Vitest cannot
    // redefine it (`Cannot redefine property: rename`). The `rename` function
    // under test always reaches `fsMove` before it ever calls fs.rename, so
    // asserting on `move` is the appropriate granularity for "did the rename
    // path actually execute".
    const fsModule = await import('@main/utils/file/fs')
    const moveSpy = vi.spyOn(fsModule, 'move')

    // Re-rename to the NFD form — same logical name, different codepoints.
    const result = await rename(deps, entry.id, nfdName)

    expect(moveSpy).not.toHaveBeenCalled()
    expect(result.id).toBe(entry.id)
    if (result.origin !== 'external' || entry.origin !== 'external') {
      throw new Error('expected external entries')
    }
    expect(result.externalPath).toBe(entry.externalPath) // still NFC-canonical
  })

  it('allows a case-only rename when the existing file at target is the same inode', async () => {
    // On case-insensitive filesystems (macOS APFS / Windows NTFS), `exists`
    // reports the file under its on-disk case, so `Foo.pdf → foo.pdf`
    // previously misfired as "target already exists". Verified via mock so
    // the test works on case-sensitive CI filesystems too.
    const original = path.join(tmp, 'CaseOnly.txt')
    await writeFile(original, 'C')
    const entry = await ensureExternal(deps, { externalPath: original as FilePath })

    // Force the "target exists" path: pretend the lowercased path exists,
    // and resolves to the same inode as the original.
    const fsModule = await import('@main/utils/file/fs')
    vi.spyOn(fsModule, 'exists').mockResolvedValue(true)
    vi.spyOn(fsModule, 'isSameFile').mockResolvedValue(true)

    const result = await rename(deps, entry.id, 'caseonly')
    expect(result.name).toBe('caseonly')
    // Physical file moved to the new case
    expect(await readFile(path.join(tmp, 'caseonly.txt'), 'utf-8')).toBe('C')
  })

  it('still throws when target exists and is a different physical file', async () => {
    // Regression guard: the case-only rename branch must NOT swallow real collisions.
    const original = path.join(tmp, 'src-collide.txt')
    const collision = path.join(tmp, 'dst-collide.txt')
    await writeFile(original, 'S')
    await writeFile(collision, 'D')
    const entry = await ensureExternal(deps, { externalPath: original as FilePath })

    await expect(rename(deps, entry.id, 'dst-collide')).rejects.toThrow(/already exists/)
    // No DB or FS state change
    const stored = await fileEntryService.getById(entry.id)
    if (stored.origin !== 'external') throw new Error('expected external entry')
    expect(stored.externalPath).toBe(original)
    expect(await readFile(original, 'utf-8')).toBe('S')
    expect(await readFile(collision, 'utf-8')).toBe('D')
  })

  it('reindexes the DanglingCache reverse index on external rename (oldPath → newPath)', async () => {
    const original = path.join(tmp, 'reindex-old.txt')
    await writeFile(original, 'hi')
    const entry = await ensureExternal(deps, { externalPath: original as FilePath })
    vi.mocked(deps.danglingCache.removeEntry).mockClear()
    vi.mocked(deps.danglingCache.addEntry).mockClear()
    vi.mocked(deps.danglingCache.onFsEvent).mockClear()
    await rename(deps, entry.id, 'reindex-new')
    expect(deps.danglingCache.removeEntry).toHaveBeenCalledWith(entry.id, original)
    expect(deps.danglingCache.addEntry).toHaveBeenCalledWith(entry.id, expect.stringContaining('reindex-new'))
    expect(deps.danglingCache.onFsEvent).toHaveBeenCalledWith(expect.stringContaining('reindex-new'), 'present', 'ops')
  })

  it('invalidates the versionCache on external rename so OCC reads fresh stat after fsMove', async () => {
    // EXDEV fallback in fsMove turns the rename into copy+unlink, producing
    // a new inode with a different mtime. A subsequent writeIfUnchanged(id,
    // expectedVersion) would otherwise compare against a pre-rename snapshot
    // and either spuriously succeed or fail. Internal renames don't move the
    // physical file so they don't need this — only external does.
    const original = path.join(tmp, 'occ-stale.txt')
    await writeFile(original, 'v1')
    const entry = await ensureExternal(deps, { externalPath: original as FilePath })
    vi.mocked(deps.versionCache.invalidate).mockClear()
    await rename(deps, entry.id, 'occ-fresh')
    expect(deps.versionCache.invalidate).toHaveBeenCalledWith(entry.id)
  })

  it('rolls FS back when the DB update fails after fsMove (best-effort skew repair)', async () => {
    // Simulate a DB-update failure between fsMove and setExternalPathAndName.
    // The rollback contract says: move the file back to its original path so
    // the on-disk state stays consistent with the DB row that did NOT update.
    // The original error from the DB is what callers see; the rollback is
    // silent on success.
    const original = path.join(tmp, 'rollback-old.txt')
    await writeFile(original, 'payload')
    const entry = await ensureExternal(deps, { externalPath: original as FilePath })

    const dbErr = new Error('UNIQUE constraint failed: file_entry.externalPath')
    const spy = vi.spyOn(deps.fileEntryService, 'setExternalPathAndName').mockRejectedValueOnce(dbErr)

    await expect(rename(deps, entry.id, 'rollback-new')).rejects.toBe(dbErr)
    spy.mockRestore()

    // FS rollback succeeded: file is back at the original path; nothing left
    // at the target.
    const targetPath = path.join(tmp, 'rollback-new.txt')
    const { existsSync } = await import('node:fs')
    expect(existsSync(original)).toBe(true)
    expect(existsSync(targetPath)).toBe(false)
    expect(await readFile(original, 'utf-8')).toBe('payload')

    // DB row was not mutated — externalPath still points at the original.
    const dbRow = await fileEntryService.findById(entry.id)
    if (dbRow?.origin !== 'external') throw new Error('expected external entry')
    expect(dbRow.externalPath).toBe(original)
    expect(dbRow.name).toBe(entry.name)
  })
})
