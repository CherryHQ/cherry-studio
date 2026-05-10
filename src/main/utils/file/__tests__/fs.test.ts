import { mkdir, mkdtemp, readdir, readFile, rm, stat as fsStatPromise, utimes, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  atomicWriteFile,
  atomicWriteIfUnchanged,
  copy as fsCopy,
  createAtomicWriteStream,
  download as fsDownload,
  ensureDir,
  exists,
  hash,
  mkdir as fsMkdir,
  move as fsMove,
  PathStaleVersionError,
  read,
  remove as fsRemove,
  removeDir,
  stat,
  write as fsWrite
} from '../fs'

describe('stat', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns size, timestamps, and isDirectory=false for a regular file', async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFile(f, 'hello world')
    const s = await stat(f as FilePath)
    expect(s.size).toBe('hello world'.length)
    expect(s.isDirectory).toBe(false)
    expect(s.modifiedAt).toBeGreaterThan(0)
    expect(s.createdAt).toBeGreaterThan(0)
  })

  it('returns isDirectory=true for a directory', async () => {
    const d = path.join(tmp, 'sub')
    await mkdir(d)
    const s = await stat(d as FilePath)
    expect(s.isDirectory).toBe(true)
  })

  it('throws ENOENT for missing path', async () => {
    await expect(stat(path.join(tmp, 'missing') as FilePath)).rejects.toThrow(/ENOENT/)
  })
})

describe('exists', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns true for an existing file', async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFile(f, 'x')
    expect(await exists(f as FilePath)).toBe(true)
  })

  it('returns true for an existing directory', async () => {
    expect(await exists(tmp as FilePath)).toBe(true)
  })

  it('returns false for a missing path', async () => {
    expect(await exists(path.join(tmp, 'nope') as FilePath)).toBe(false)
  })
})

describe('read (text)', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('reads UTF-8 text content (default)', async () => {
    const f = path.join(tmp, 't.txt')
    await writeFile(f, '你好 hello', 'utf-8')
    const out = await read(f as FilePath)
    expect(out).toBe('你好 hello')
  })

  it('reads with explicit text encoding option', async () => {
    const f = path.join(tmp, 't2.txt')
    await writeFile(f, 'plain', 'utf-8')
    const out = await read(f as FilePath, { encoding: 'text' })
    expect(out).toBe('plain')
  })

  it('throws ENOENT on missing path', async () => {
    await expect(read(path.join(tmp, 'missing') as FilePath)).rejects.toThrow(/ENOENT/)
  })
})

describe('read (base64)', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns base64-encoded data and inferred mime', async () => {
    const f = path.join(tmp, 'a.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await writeFile(f, bytes)
    const out = await read(f as FilePath, { encoding: 'base64' })
    expect(out.data).toBe(bytes.toString('base64'))
    expect(out.mime).toBe('image/png')
  })
})

describe('read (binary)', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns Uint8Array data and inferred mime', async () => {
    const f = path.join(tmp, 'a.pdf')
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    await writeFile(f, bytes)
    const out = await read(f as FilePath, { encoding: 'binary' })
    expect(out.data).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(out.data).equals(Buffer.from(bytes))).toBe(true)
    expect(out.mime).toBe('application/pdf')
  })
})

describe('hash', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns deterministic hash for same content', async () => {
    const f1 = path.join(tmp, 'a.txt')
    const f2 = path.join(tmp, 'b.txt')
    await writeFile(f1, 'hello world')
    await writeFile(f2, 'hello world')
    const h1 = await hash(f1 as FilePath)
    const h2 = await hash(f2 as FilePath)
    expect(h1).toBe(h2)
  })

  it('returns different hashes for different content', async () => {
    const f1 = path.join(tmp, 'a.txt')
    const f2 = path.join(tmp, 'b.txt')
    await writeFile(f1, 'hello world')
    await writeFile(f2, 'goodbye world')
    expect(await hash(f1 as FilePath)).not.toBe(await hash(f2 as FilePath))
  })

  it('returns lowercase hex string', async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFile(f, 'sample')
    const h = await hash(f as FilePath)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('returns 16-char xxhash-h64 hex (not 32-char md5)', async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFile(f, 'sample')
    const h = await hash(f as FilePath)
    expect(h).toHaveLength(16)
  })

  it('matches the known xxhash-h64 fixture for "hello"', async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFile(f, 'hello')
    const h = await hash(f as FilePath)
    // xxhash-h64('hello') = 0x26c7827d889f6da3 (default seed = 0).
    expect(h).toBe('26c7827d889f6da3')
  })
})

describe('atomicWriteFile', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('writes string content to a fresh path and leaves no .tmp- residue', async () => {
    const target = path.join(tmp, 'a.txt') as FilePath
    await atomicWriteFile(target, 'hello')
    expect(await readFile(target, 'utf-8')).toBe('hello')
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('writes Uint8Array content', async () => {
    const target = path.join(tmp, 'b.bin') as FilePath
    const data = new Uint8Array([0x01, 0x02, 0x03])
    await atomicWriteFile(target, data)
    const buf = await readFile(target)
    expect(Buffer.from(buf).equals(Buffer.from(data))).toBe(true)
  })

  it('overwrites an existing target atomically', async () => {
    const target = path.join(tmp, 'c.txt') as FilePath
    await atomicWriteFile(target, 'first')
    await atomicWriteFile(target, 'second')
    expect(await readFile(target, 'utf-8')).toBe('second')
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('cleans up the tmp file when rename fails', async () => {
    // Make the target directory read-only after pre-creating an existing file there,
    // then attempt to overwrite — rename(tmp → target) cannot succeed because the
    // directory is read-only on POSIX. Skip on Windows where chmod semantics differ.
    if (process.platform === 'win32') return
    const target = path.join(tmp, 'd.txt') as FilePath
    await atomicWriteFile(target, 'baseline')
    const { chmod } = await import('node:fs/promises')
    await chmod(tmp, 0o555)
    try {
      await expect(atomicWriteFile(target, 'second')).rejects.toThrow()
    } finally {
      await chmod(tmp, 0o755)
    }
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
    expect(await readFile(target, 'utf-8')).toBe('baseline')
  })
})

describe('atomicWriteIfUnchanged', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('writes when current version matches expected', async () => {
    const target = path.join(tmp, 'a.txt') as FilePath
    await writeFile(target, 'first')
    const s = await fsStatPromise(target)
    const expected = { mtime: Math.floor(s.mtimeMs), size: s.size }
    const next = await atomicWriteIfUnchanged(target, 'second', expected)
    expect(await readFile(target, 'utf-8')).toBe('second')
    expect(next.size).toBe(6)
    expect(next.mtime).toBeGreaterThanOrEqual(expected.mtime)
  })

  it('throws PathStaleVersionError when size differs', async () => {
    const target = path.join(tmp, 'b.txt') as FilePath
    await writeFile(target, 'twelve chars')
    const expected = { mtime: 0, size: 1 }
    await expect(atomicWriteIfUnchanged(target, 'next', expected)).rejects.toBeInstanceOf(PathStaleVersionError)
    expect(await readFile(target, 'utf-8')).toBe('twelve chars')
  })

  it('throws PathStaleVersionError when mtime differs', async () => {
    const target = path.join(tmp, 'c.txt') as FilePath
    await writeFile(target, 'same-size')
    const expected = { mtime: 12345, size: 'same-size'.length }
    await expect(atomicWriteIfUnchanged(target, 'next-size', expected)).rejects.toBeInstanceOf(PathStaleVersionError)
    expect(await readFile(target, 'utf-8')).toBe('same-size')
  })

  it('treats second-precision mtime + same size as match (ambiguous branch)', async () => {
    const target = path.join(tmp, 'd.txt') as FilePath
    await writeFile(target, 'aaaa')
    // Force second-precision mtime: utimes with whole-second values.
    await utimes(target, 1700000000, 1700000000)
    const expected = { mtime: 1700000000_000, size: 4 }
    const next = await atomicWriteIfUnchanged(target, 'bbbb', expected)
    expect(await readFile(target, 'utf-8')).toBe('bbbb')
    expect(next.size).toBe(4)
  })

  it('throws when both mtimes are second-precision but unequal (different second values)', async () => {
    // Regression: previously `ambiguousMtime` only required both mtimes to be
    // whole-second values, not equal — so a concurrent edit that changed mtime
    // by a whole second with size unchanged would silently overwrite.
    const target = path.join(tmp, 'd2.txt') as FilePath
    await writeFile(target, 'aaaa')
    await utimes(target, 1700000001, 1700000001) // current is 1700000001 sec
    const expected = { mtime: 1700000000_000, size: 4 } // expected was 1700000000 sec
    await expect(atomicWriteIfUnchanged(target, 'bbbb', expected)).rejects.toBeInstanceOf(PathStaleVersionError)
    expect(await readFile(target, 'utf-8')).toBe('aaaa')
  })

  it('with expectedContentHash, throws when hash differs in ambiguous branch', async () => {
    const target = path.join(tmp, 'e.txt') as FilePath
    await writeFile(target, 'aaaa')
    await utimes(target, 1700000000, 1700000000)
    const expected = { mtime: 1700000000_000, size: 4 }
    const wrongHash = '0'.repeat(32)
    await expect(atomicWriteIfUnchanged(target, 'bbbb', expected, wrongHash)).rejects.toBeInstanceOf(
      PathStaleVersionError
    )
    expect(await readFile(target, 'utf-8')).toBe('aaaa')
  })
})

describe('write', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('writes string content atomically', async () => {
    const target = path.join(tmp, 'a.txt') as FilePath
    await fsWrite(target, 'hello')
    expect(await readFile(target, 'utf-8')).toBe('hello')
  })

  it('overwrites existing target without leaving tmp residue', async () => {
    const target = path.join(tmp, 'b.txt') as FilePath
    await fsWrite(target, 'first')
    await fsWrite(target, 'second')
    expect(await readFile(target, 'utf-8')).toBe('second')
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })
})

describe('copy', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('copies file content from src to dest', async () => {
    const src = path.join(tmp, 'src.txt')
    const dest = path.join(tmp, 'dest.txt')
    await writeFile(src, 'payload')
    await fsCopy(src as FilePath, dest as FilePath)
    expect(await readFile(dest, 'utf-8')).toBe('payload')
    expect(await readFile(src, 'utf-8')).toBe('payload')
  })

  it('overwrites an existing dest atomically (no tmp residue)', async () => {
    const src = path.join(tmp, 'src.txt')
    const dest = path.join(tmp, 'dest.txt')
    await writeFile(src, 'new')
    await writeFile(dest, 'old')
    await fsCopy(src as FilePath, dest as FilePath)
    expect(await readFile(dest, 'utf-8')).toBe('new')
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('preserves binary content byte-for-byte', async () => {
    const src = path.join(tmp, 'src.bin')
    const dest = path.join(tmp, 'dest.bin')
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x20, 0x80])
    await writeFile(src, bytes)
    await fsCopy(src as FilePath, dest as FilePath)
    const out = await readFile(dest)
    expect(out.equals(bytes)).toBe(true)
  })
})

describe('move', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('renames within the same directory', async () => {
    const src = path.join(tmp, 'src.txt')
    const dest = path.join(tmp, 'dest.txt')
    await writeFile(src, 'payload')
    await fsMove(src as FilePath, dest as FilePath)
    expect(await exists(src as FilePath)).toBe(false)
    expect(await readFile(dest, 'utf-8')).toBe('payload')
  })

  it('moves across nested directories within the same mount', async () => {
    const sub = path.join(tmp, 'a', 'b')
    await mkdir(sub, { recursive: true })
    const src = path.join(tmp, 'src.txt')
    const dest = path.join(sub, 'dest.txt')
    await writeFile(src, 'payload')
    await fsMove(src as FilePath, dest as FilePath)
    expect(await exists(src as FilePath)).toBe(false)
    expect(await readFile(dest, 'utf-8')).toBe('payload')
  })
})

describe('remove', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('removes an existing file', async () => {
    const target = path.join(tmp, 'a.txt') as FilePath
    await writeFile(target, 'x')
    await fsRemove(target)
    expect(await exists(target)).toBe(false)
  })

  it('is idempotent on a missing path (no throw)', async () => {
    const target = path.join(tmp, 'nope.txt') as FilePath
    await expect(fsRemove(target)).resolves.toBeUndefined()
  })
})

describe('mkdir / ensureDir / removeDir', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('mkdir creates a single nested directory', async () => {
    const target = path.join(tmp, 'a') as FilePath
    await fsMkdir(target)
    const s = await stat(target)
    expect(s.isDirectory).toBe(true)
  })

  it('ensureDir creates a deeply nested path and is idempotent', async () => {
    const target = path.join(tmp, 'a', 'b', 'c') as FilePath
    await ensureDir(target)
    expect((await stat(target)).isDirectory).toBe(true)
    // Idempotent — second call must not throw.
    await ensureDir(target)
    expect((await stat(target)).isDirectory).toBe(true)
  })

  it('removeDir recursively removes a tree', async () => {
    const root = path.join(tmp, 'r')
    await mkdir(path.join(root, 'sub'), { recursive: true })
    await writeFile(path.join(root, 'sub', 'f.txt'), 'x')
    await removeDir(root as FilePath)
    expect(await exists(root as FilePath)).toBe(false)
  })

  it('removeDir is idempotent on a missing path', async () => {
    await expect(removeDir(path.join(tmp, 'nope') as FilePath)).resolves.toBeUndefined()
  })
})

describe('download', () => {
  let tmp: string
  let server: Server
  let baseUrl: string
  let routes: Map<string, { status: number; body: Uint8Array | string; type?: string }>

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
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
    await rm(tmp, { recursive: true, force: true })
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('downloads response body to dest atomically', async () => {
    routes.set('/file.bin', { status: 200, body: Buffer.from([0x01, 0x02, 0x03]), type: 'application/octet-stream' })
    const dest = path.join(tmp, 'out.bin') as FilePath
    await fsDownload(`${baseUrl}/file.bin`, dest)
    const buf = await readFile(dest)
    expect(Array.from(buf)).toEqual([0x01, 0x02, 0x03])
  })

  it('throws and leaves no dest file on a non-2xx response', async () => {
    routes.set('/missing', { status: 404, body: 'gone' })
    const dest = path.join(tmp, 'out.bin') as FilePath
    await expect(fsDownload(`${baseUrl}/missing`, dest)).rejects.toThrow()
    expect(await exists(dest)).toBe(false)
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })
})

describe('createAtomicWriteStream', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('commits target on .end() and leaves no tmp residue', async () => {
    const target = path.join(tmp, 'a.txt') as FilePath
    const stream = createAtomicWriteStream(target)
    stream.write('hel')
    stream.write('lo')
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve)
      stream.on('error', reject)
      stream.end()
    })
    expect(await readFile(target, 'utf-8')).toBe('hello')
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('aborts cleanly on .abort() — no target write, no tmp residue', async () => {
    const target = path.join(tmp, 'b.txt') as FilePath
    const stream = createAtomicWriteStream(target)
    stream.write('partial')
    await stream.abort()
    expect(await exists(target)).toBe(false)
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('cleans up tmp file when destroyed with an error', async () => {
    const target = path.join(tmp, 'c.txt') as FilePath
    const stream = createAtomicWriteStream(target)
    stream.write('partial')
    await new Promise<void>((resolve) => {
      stream.on('error', () => resolve())
      stream.on('close', () => resolve())
      stream.destroy(new Error('intentional'))
    })
    // Wait one tick for cleanup unlink to settle
    await new Promise((r) => setTimeout(r, 50))
    expect(await exists(target)).toBe(false)
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })
})
