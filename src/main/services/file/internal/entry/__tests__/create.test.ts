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
const { createInternal, ensureExternal } = await import('../create')

import type { FileManagerDeps } from '../../deps'

describe('internal/entry/create.createInternal', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let filesDir: string
  let deps: FileManagerDeps

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-createtest-'))
    filesDir = path.join(tmp, 'Files')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(filesDir, { recursive: true })
    // Override application.getPath so internal entries land in the test tmpdir.
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
        forceRecheck: vi.fn(),
        onFsEvent: vi.fn(),
        addEntry: vi.fn(),
        removeEntry: vi.fn(),
        initFromDb: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        onDanglingStateChanged: vi.fn(() => ({ dispose: () => {} })),
        clear: vi.fn()
      },
      versionCache: {
        get: vi.fn(),
        set: vi.fn(),
        invalidate: vi.fn(),
        clear: vi.fn()
      }
    }
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(tmp, { recursive: true, force: true })
  })

  describe('source: bytes', () => {
    it('writes content to {filesDir}/{id}.{ext} and inserts a parsed FileEntry', async () => {
      const data = new Uint8Array([0x01, 0x02, 0x03, 0x04])
      const entry = await createInternal(deps, { source: 'bytes', data, name: 'doc', ext: 'bin' })
      expect(entry.origin).toBe('internal')
      expect(entry.name).toBe('doc')
      expect(entry.ext).toBe('bin')
      expect(entry.size).toBe(4)
      const physical = path.join(filesDir, `${entry.id}.bin`)
      const onDisk = await readFile(physical)
      expect(Buffer.from(onDisk).equals(Buffer.from(data))).toBe(true)
    })

    it('writes a row that survives schema parse (brand contract)', async () => {
      const entry = await createInternal(deps, { source: 'bytes', data: new Uint8Array([0]), name: 'x', ext: null })
      const found = await fileEntryService.getById(entry.id)
      expect(found.id).toBe(entry.id)
      expect(found.size).toBe(1)
    })
  })

  describe('source: base64', () => {
    it('decodes data: URI, derives ext from mime, and writes content', async () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG magic
      const base64 = Buffer.from(bytes).toString('base64')
      const dataUri = `data:image/png;base64,${base64}` as `data:${string};base64,${string}`
      const entry = await createInternal(deps, { source: 'base64', data: dataUri })
      expect(entry.origin).toBe('internal')
      expect(entry.size).toBe(4)
      expect(entry.ext).toBe('png')
      expect(entry.name.length).toBeGreaterThan(0)
    })
  })

  describe('ensureExternal DanglingCache wiring', () => {
    it('on insert: registers the entry in the reverse index AND records a "present" observation', async () => {
      const file = path.join(tmp, 'ext-new.txt')
      await writeFile(file, 'hello')
      const e = await ensureExternal(deps, { externalPath: file as FilePath })
      expect(deps.danglingCache.addEntry).toHaveBeenCalledWith(e.id, expect.any(String))
      expect(deps.danglingCache.onFsEvent).toHaveBeenCalledWith(expect.any(String), 'present', 'ops')
    })

    it('on reuse (same canonical path): does NOT add a duplicate index entry', async () => {
      const file = path.join(tmp, 'ext-reuse.txt')
      await writeFile(file, 'hello')
      await ensureExternal(deps, { externalPath: file as FilePath })
      vi.mocked(deps.danglingCache.addEntry).mockClear()
      vi.mocked(deps.danglingCache.onFsEvent).mockClear()
      // Second call resolves to the already-inserted row.
      await ensureExternal(deps, { externalPath: file as FilePath })
      expect(deps.danglingCache.addEntry).not.toHaveBeenCalled()
      expect(deps.danglingCache.onFsEvent).not.toHaveBeenCalled()
    })
  })
})
