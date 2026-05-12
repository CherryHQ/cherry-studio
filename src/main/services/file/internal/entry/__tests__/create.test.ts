import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
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
      },
      orphanRegistry: createDefaultOrphanCheckerRegistry()
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

    it('unlinks the physical blob when the DB insert throws (DB-FS convergence guard)', async () => {
      // Drive fileEntryService.create to fail AFTER the physical file is
      // written but BEFORE the DB row commits. Without the bestEffortCleanup
      // call in createInternal, the orphan blob would persist until the next
      // startup file sweep — the regression this test pins.
      const insertErr = new Error('UNIQUE constraint failed: file_entry.id')
      const spy = vi.spyOn(fileEntryService, 'create').mockRejectedValueOnce(insertErr)
      await expect(
        createInternal(deps, { source: 'bytes', data: new Uint8Array([1, 2, 3]), name: 'rollback-doc', ext: 'bin' })
      ).rejects.toBe(insertErr)
      spy.mockRestore()

      // No file should remain in filesDir — the cleanup unlinked it.
      const { readdir } = await import('node:fs/promises')
      const remaining = await readdir(filesDir)
      expect(remaining).toEqual([])
    })
  })

  describe('source: url', () => {
    let server: Server
    let baseUrl: string
    let routes: Map<string, { status: number; body: Buffer; type?: string }>

    beforeEach(async () => {
      routes = new Map()
      const http = await import('node:http')
      server = http.createServer((req, res) => {
        const route = routes.get(req.url ?? '/')
        if (!route) {
          res.statusCode = 404
          res.end('not found')
          return
        }
        res.statusCode = route.status
        if (route.type) res.setHeader('Content-Type', route.type)
        res.end(route.body)
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const addr = server.address() as { port: number }
      baseUrl = `http://127.0.0.1:${addr.port}`
    })

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })

    it('downloads to storage and derives name + ext from the URL path basename', async () => {
      routes.set('/photos/sunset.png', { status: 200, body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) })
      const entry = await createInternal(deps, { source: 'url', url: `${baseUrl}/photos/sunset.png` as never })
      expect(entry.name).toBe('sunset')
      expect(entry.ext).toBe('png')
      expect(entry.size).toBe(4)
      // Verify the downloaded bytes ended up at the expected storage path.
      const physical = path.join(filesDir, `${entry.id}.png`)
      const buf = await readFile(physical)
      expect(Array.from(buf)).toEqual([0x89, 0x50, 0x4e, 0x47])
    })

    it('derives ext=null when the URL path has no recognisable extension', async () => {
      routes.set('/no-extension-here', { status: 200, body: Buffer.from('hi') })
      const entry = await createInternal(deps, { source: 'url', url: `${baseUrl}/no-extension-here` as never })
      expect(entry.name).toBe('no-extension-here')
      expect(entry.ext).toBeNull()
    })

    it('strips only the final dot segment when the path contains multiple dots', async () => {
      // urlTail keeps the part before the LAST dot as the name; extWithoutDot
      // takes only the final segment as ext. So `foo.bar.baz` → name `foo.bar`, ext `baz`.
      routes.set('/foo.bar.baz', { status: 200, body: Buffer.from('hi') })
      const entry = await createInternal(deps, { source: 'url', url: `${baseUrl}/foo.bar.baz` as never })
      expect(entry.name).toBe('foo.bar')
      expect(entry.ext).toBe('baz')
    })

    it('falls back to hostname when the URL path is empty', async () => {
      // URL like `http://example.com/` has pathname '/', whose split('/').pop()
      // is the empty string — urlTail then falls through to u.hostname.
      routes.set('/', { status: 200, body: Buffer.from('hi') })
      const entry = await createInternal(deps, { source: 'url', url: `${baseUrl}/` as never })
      expect(entry.name).toBe('127.0.0.1')
      expect(entry.ext).toBeNull()
    })

    it('propagates the download error and writes no DB row when the server returns non-2xx', async () => {
      routes.set('/missing', { status: 404, body: Buffer.from('gone') })
      await expect(createInternal(deps, { source: 'url', url: `${baseUrl}/missing` as never })).rejects.toThrow()
      // No DB row should have been inserted.
      const all = await dbh.db.select().from((await import('@data/db/schemas/file')).fileEntryTable)
      expect(all).toHaveLength(0)
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

    it('propagates findCaseInsensitivePeers errors instead of silently falling through to create()', async () => {
      // Re-wrapping the peer SELECT in try/catch swallows the error one frame
      // earlier than the imminent INSERT failure, masking the real cause.
      // This assertion fails the moment that try/catch comes back.
      const file = path.join(tmp, 'peer-probe-fail.txt')
      await writeFile(file, 'x')
      const probeErr = new Error('peer SELECT boom')
      vi.spyOn(fileEntryService, 'findCaseInsensitivePeers').mockRejectedValueOnce(probeErr)
      await expect(ensureExternal(deps, { externalPath: file as FilePath })).rejects.toBe(probeErr)
    })
  })
})
