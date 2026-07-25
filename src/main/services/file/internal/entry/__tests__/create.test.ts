import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
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
      const entry = await createInternal(deps, {
        source: 'bytes',
        data,
        name: 'doc',
        ext: 'bin',
        cleanupPolicy: 'manual'
      })
      expect(entry.origin).toBe('internal')
      expect(entry.name).toBe('doc')
      expect(entry.ext).toBe('bin')
      if (entry.origin !== 'internal') throw new Error('expected internal entry')
      expect(entry.size).toBe(4)
      const physical = path.join(filesDir, `${entry.id}.bin`)
      const onDisk = await readFile(physical)
      expect(Buffer.from(onDisk).equals(Buffer.from(data))).toBe(true)
    })

    it('writes a row that survives schema parse (brand contract)', async () => {
      const entry = await createInternal(deps, {
        source: 'bytes',
        data: new Uint8Array([0]),
        name: 'x',
        ext: null,
        cleanupPolicy: 'manual'
      })
      const found = fileEntryService.getById(entry.id)
      expect(found.id).toBe(entry.id)
      if (found.origin !== 'internal') throw new Error('expected internal entry')
      expect(found.size).toBe(1)
    })

    it('unlinks the physical blob when the DB insert throws (DB-FS convergence guard)', async () => {
      // Drive fileEntryService.create to fail AFTER the physical file is
      // written but BEFORE the DB row commits. Without the bestEffortCleanup
      // call in createInternal, the orphan blob would persist until the next
      // startup file sweep — the regression this test pins.
      const insertErr = new Error('UNIQUE constraint failed: file_entry.id')
      const spy = vi.spyOn(fileEntryService, 'create').mockImplementationOnce(() => {
        throw insertErr
      })
      await expect(
        createInternal(deps, {
          source: 'bytes',
          data: new Uint8Array([1, 2, 3]),
          name: 'rollback-doc',
          ext: 'bin',
          cleanupPolicy: 'manual'
        })
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
      const entry = await createInternal(deps, {
        source: 'url',
        url: `${baseUrl}/photos/sunset.png` as never,
        cleanupPolicy: 'manual'
      })
      expect(entry.name).toBe('sunset')
      expect(entry.ext).toBe('png')
      if (entry.origin !== 'internal') throw new Error('expected internal entry')
      expect(entry.size).toBe(4)
      // Verify the downloaded bytes ended up at the expected storage path.
      const physical = path.join(filesDir, `${entry.id}.png`)
      const buf = await readFile(physical)
      expect(Array.from(buf)).toEqual([0x89, 0x50, 0x4e, 0x47])
    })

    it('derives ext=null when the URL path has no recognisable extension', async () => {
      routes.set('/no-extension-here', { status: 200, body: Buffer.from('hi') })
      const entry = await createInternal(deps, {
        source: 'url',
        url: `${baseUrl}/no-extension-here` as never,
        cleanupPolicy: 'manual'
      })
      expect(entry.name).toBe('no-extension-here')
      expect(entry.ext).toBeNull()
    })

    it('strips only the final dot segment when the path contains multiple dots', async () => {
      // urlTail keeps the part before the LAST dot as the name; extWithoutDot
      // takes only the final segment as ext. So `foo.bar.baz` → name `foo.bar`, ext `baz`.
      routes.set('/foo.bar.baz', { status: 200, body: Buffer.from('hi') })
      const entry = await createInternal(deps, {
        source: 'url',
        url: `${baseUrl}/foo.bar.baz` as never,
        cleanupPolicy: 'manual'
      })
      expect(entry.name).toBe('foo.bar')
      expect(entry.ext).toBe('baz')
    })

    it('falls back to hostname when the URL path is empty', async () => {
      // URL like `http://example.com/` has pathname '/', whose split('/').pop()
      // is the empty string — urlTail then falls through to u.hostname.
      routes.set('/', { status: 200, body: Buffer.from('hi') })
      const entry = await createInternal(deps, {
        source: 'url',
        url: `${baseUrl}/` as never,
        cleanupPolicy: 'manual'
      })
      expect(entry.name).toBe('127.0.0.1')
      expect(entry.ext).toBeNull()
    })

    it('propagates the download error and writes no DB row when the server returns non-2xx', async () => {
      routes.set('/missing', { status: 404, body: Buffer.from('gone') })
      await expect(
        createInternal(deps, { source: 'url', url: `${baseUrl}/missing` as never, cleanupPolicy: 'manual' })
      ).rejects.toThrow()
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
      const entry = await createInternal(deps, { source: 'base64', data: dataUri, cleanupPolicy: 'manual' })
      expect(entry.origin).toBe('internal')
      if (entry.origin !== 'internal') throw new Error('expected internal entry')
      expect(entry.size).toBe(4)
      expect(entry.ext).toBe('png')
      expect(entry.name.length).toBeGreaterThan(0)
    })
  })

  describe('ensureExternal DanglingCache wiring', () => {
    it('on insert: registers the entry in the reverse index AND records a "present" observation', async () => {
      const file = path.join(tmp, 'ext-new.txt')
      await writeFile(file, 'hello')
      const e = await ensureExternal(deps, { externalPath: file as AbsoluteFilePath, cleanupPolicy: 'manual' })
      expect(deps.danglingCache.addEntry).toHaveBeenCalledWith(e.id, expect.any(String))
      expect(deps.danglingCache.onFsEvent).toHaveBeenCalledWith(expect.any(String), 'present', 'ops')
    })

    it('on reuse (same canonical path): does NOT add a duplicate index entry', async () => {
      const file = path.join(tmp, 'ext-reuse.txt')
      await writeFile(file, 'hello')
      await ensureExternal(deps, { externalPath: file as AbsoluteFilePath, cleanupPolicy: 'manual' })
      vi.mocked(deps.danglingCache.addEntry).mockClear()
      vi.mocked(deps.danglingCache.onFsEvent).mockClear()
      // Second call resolves to the already-inserted row.
      await ensureExternal(deps, { externalPath: file as AbsoluteFilePath, cleanupPolicy: 'manual' })
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
      vi.spyOn(fileEntryService, 'findCaseInsensitivePeers').mockImplementationOnce(() => {
        throw probeErr
      })
      await expect(
        ensureExternal(deps, { externalPath: file as AbsoluteFilePath, cleanupPolicy: 'manual' })
      ).rejects.toBe(probeErr)
    })
  })

  describe('ensureExternal case-collision policy (M2: functional unique index + fs.realpath)', () => {
    // Background: `fe_external_path_lower_unique_idx` enforces case-insensitive
    // uniqueness on `externalPath` at the DB layer. Application-side, the
    // collision is disambiguated up front via `fs.realpath` so we never
    // attempt an INSERT we know will fail with SQLITE_CONSTRAINT.
    //
    // Two FS classes exercise different branches: macOS APFS / Windows NTFS
    // (case-insensitive default) where `A.txt` and `a.txt` resolve to the
    // same on-disk entry, vs Linux ext4 (case-sensitive) where they are
    // genuinely different files.

    it.skipIf(process.platform === 'linux')(
      'reuses the peer when fs.realpath confirms case-different paths are the same FS entity (macOS/win case-insensitive default)',
      async () => {
        const upper = path.join(tmp, 'COLLIDE.txt')
        const lower = path.join(tmp, 'collide.txt')
        // On a case-insensitive FS the single writeFile produces a file whose
        // on-disk canonical case is whatever the FS recorded (typically
        // mirrors the first write). Both inputs resolve to that same on-disk
        // form via fs.realpath, so the second ensureExternal hits the byte-
        // exact miss, finds the first as a case-insensitive peer, realpaths
        // both to the same string, and returns the existing entry.
        await writeFile(upper, 'x')
        const first = await ensureExternal(deps, { externalPath: upper as AbsoluteFilePath, cleanupPolicy: 'manual' })
        const second = await ensureExternal(deps, { externalPath: lower as AbsoluteFilePath, cleanupPolicy: 'manual' })
        expect(second.id).toBe(first.id)
      }
    )

    it.skipIf(process.platform === 'linux')(
      'inserts instead of failing when a concurrent cleanup reclaims the peer during realpath',
      async () => {
        // The peer lookup is synchronous, but `resolveCaseCollisionPeer` awaits
        // fs.realpath — that yield lets the cleanup pass reclaim the peer, whose
        // shape (auto policy, zero refs, past grace) is precisely its target.
        // `ensureExternal` is contracted to *ensure an entry exists*, so losing
        // that race must fall through to the insert, not reject an add-to-library.
        const upper = path.join(tmp, 'RACE.txt')
        const lower = path.join(tmp, 'race.txt')
        await writeFile(upper, 'x')
        const first = await ensureExternal(deps, {
          externalPath: upper as AbsoluteFilePath,
          cleanupPolicy: 'delete_when_unreferenced'
        })

        // Delete the row as the peers are handed back: by the time the awaited
        // realpath resolves and the peer is re-read, it is genuinely gone — the
        // same state a real interleaved cleanup pass would leave behind.
        const findPeers = fileEntryService.findCaseInsensitivePeers.bind(fileEntryService)
        vi.spyOn(fileEntryService, 'findCaseInsensitivePeers').mockImplementationOnce((canonical) => {
          const peers = findPeers(canonical)
          fileEntryService.delete(first.id)
          return peers
        })

        const second = await ensureExternal(deps, {
          externalPath: lower as AbsoluteFilePath,
          cleanupPolicy: 'delete_when_unreferenced'
        })
        expect(second.id).not.toBe(first.id)
        expect(fileEntryService.findById(second.id)).not.toBeNull()
      }
    )

    it.runIf(process.platform === 'linux')(
      'throws when two case-different paths refer to genuinely distinct files (linux ext4 case-sensitive)',
      async () => {
        const upper = path.join(tmp, 'COLLIDE.txt')
        const lower = path.join(tmp, 'collide.txt')
        await writeFile(upper, 'A')
        await writeFile(lower, 'a')
        await ensureExternal(deps, { externalPath: upper as AbsoluteFilePath, cleanupPolicy: 'manual' })
        await expect(
          ensureExternal(deps, { externalPath: lower as AbsoluteFilePath, cleanupPolicy: 'manual' })
        ).rejects.toThrow(/case-collision/i)
      }
    )

    it.runIf(process.platform === 'linux')(
      'throws when the case-collision peer is dangling (linux-only — case-insensitive FS would fold the peer onto the real file)',
      async () => {
        // Insert a phantom external row directly: its externalPath does NOT
        // exist on disk, so realpath ENOENTs and no FS-entity reuse is
        // possible. On case-insensitive filesystems (macOS APFS default,
        // NTFS default) the FS folds the peer's case-different path onto
        // the existing on-disk file's inode, so realpath succeeds and the
        // "dangling" scenario is unreachable — only Linux ext4 (and
        // case-sensitive APFS volumes, which the runner doesn't have)
        // expose it.
        const { fileEntryTable } = await import('@data/db/schemas/file')
        const realFile = path.join(tmp, 'real.txt')
        await writeFile(realFile, 'x')
        const phantomCaseDifferent = path.join(tmp, 'REAL.txt') // not on disk
        await dbh.db.insert(fileEntryTable).values({
          id: '019606a0-0000-7000-8000-aaaaaaaaaaaa',
          origin: 'external',
          name: 'REAL',
          ext: 'txt',
          size: null,
          externalPath: phantomCaseDifferent,
          deletedAt: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
        await expect(
          ensureExternal(deps, { externalPath: realFile as AbsoluteFilePath, cleanupPolicy: 'manual' })
        ).rejects.toThrow(/case-collision/i)
      }
    )

    it.skipIf(process.platform === 'linux')(
      'upgrades delete_when_unreferenced to manual through the case-collision peer reuse path',
      async () => {
        const upper = path.join(tmp, 'UPGRADE.txt')
        const lower = path.join(tmp, 'upgrade.txt')
        await writeFile(upper, 'x')
        const first = await ensureExternal(deps, {
          externalPath: upper as AbsoluteFilePath,
          cleanupPolicy: 'delete_when_unreferenced'
        })
        expect(first.cleanupPolicy).toBe('delete_when_unreferenced')
        const second = await ensureExternal(deps, { externalPath: lower as AbsoluteFilePath, cleanupPolicy: 'manual' })
        expect(second.id).toBe(first.id)
        expect(second.cleanupPolicy).toBe('manual')
      }
    )

    it.skipIf(process.platform === 'linux')(
      'does not downgrade manual to delete_when_unreferenced through the case-collision peer reuse path',
      async () => {
        const upper = path.join(tmp, 'NODOWNGRADE.txt')
        const lower = path.join(tmp, 'nodowngrade.txt')
        await writeFile(upper, 'x')
        const first = await ensureExternal(deps, { externalPath: upper as AbsoluteFilePath, cleanupPolicy: 'manual' })
        expect(first.cleanupPolicy).toBe('manual')
        const second = await ensureExternal(deps, {
          externalPath: lower as AbsoluteFilePath,
          cleanupPolicy: 'delete_when_unreferenced'
        })
        expect(second.id).toBe(first.id)
        expect(second.cleanupPolicy).toBe('manual')
      }
    )
  })

  describe('ensureExternal byte-faithful derivation', () => {
    // `externalPath` is stored byte-faithful — `canonicalizeFilePath` does NOT
    // Unicode-normalize, so an NFD-named file keeps its NFD bytes end to end:
    // the stored path reaches the real file on every filesystem (including
    // Linux ext4, where an NFC-rewritten path would ENOENT), and `name`/`ext`
    // are derived from that byte-faithful path, not folded to NFC. Runs on all
    // platforms: the byte-faithful path matches the on-disk bytes everywhere.
    it('derives name/ext from the byte-faithful canonical path (NFD stays NFD, no NFC fold)', async () => {
      // ASCII \u escapes (not raw accented literals) so formatter/editor tooling
      // cannot silently re-normalize the NFD form and turn this into a tautology.
      const nfdName = 'qu\u0065\u0301' // q, u, e, combining acute -> NFD
      const nfcName = 'qu\u00E9' // q, u, e-precomposed -> NFC
      expect(nfdName).not.toBe(nfcName) // byte-distinct strings
      expect(nfdName.normalize('NFC')).toBe(nfcName)

      const file = path.join(tmp, `${nfdName}.txt`)
      await writeFile(file, 'x')
      const entry = await ensureExternal(deps, {
        externalPath: AbsoluteFilePathSchema.parse(file),
        cleanupPolicy: 'manual'
      })

      if (entry.origin !== 'external') throw new Error('expected external entry')
      // The stored externalPath is byte-faithful — the exact NFD bytes we passed,
      // NOT folded to NFC.
      const canonical = entry.externalPath
      expect(canonical).toBe(file)
      expect(canonical).not.toBe(file.normalize('NFC'))
      // name derives from the byte-faithful (NFD) basename, not an NFC fold.
      expect(entry.name).toBe(nfdName)
      expect(entry.name).not.toBe(nfcName)
      // Round-trip equality through path.basename holds byte-for-byte.
      expect(path.basename(canonical, '.txt')).toBe(entry.name)
    })
  })

  describe('cleanupPolicy', () => {
    it('persists the caller-supplied cleanupPolicy', async () => {
      const entry = await createInternal(deps, {
        source: 'bytes',
        data: new TextEncoder().encode('x'),
        name: 'gc-probe',
        ext: 'txt',
        cleanupPolicy: 'delete_when_unreferenced'
      })
      expect(entry.cleanupPolicy).toBe('delete_when_unreferenced')
    })

    it('ensureExternal reuse upgrades delete_when_unreferenced to manual but never downgrades', async () => {
      const extPath = path.join(tmp, 'cleanup-policy.txt') as AbsoluteFilePath
      await writeFile(extPath, 'x')
      const first = await ensureExternal(deps, { externalPath: extPath, cleanupPolicy: 'delete_when_unreferenced' })
      expect(first.cleanupPolicy).toBe('delete_when_unreferenced')
      const upgraded = await ensureExternal(deps, { externalPath: extPath, cleanupPolicy: 'manual' })
      expect(upgraded.id).toBe(first.id)
      expect(upgraded.cleanupPolicy).toBe('manual')
      const notDowngraded = await ensureExternal(deps, {
        externalPath: extPath,
        cleanupPolicy: 'delete_when_unreferenced'
      })
      expect(notDowngraded.cleanupPolicy).toBe('manual')
    })
  })
})
