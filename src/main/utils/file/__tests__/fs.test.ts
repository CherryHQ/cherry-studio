import { mkdir, mkdtemp, open, readdir, readFile, rm, stat as fsStatPromise, utimes, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ContentHashSchema } from '@shared/data/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'

import { hashContent } from '../contentHash'
import {
  atomicWriteFile,
  atomicWriteIfUnchanged,
  copy as fsCopy,
  createAtomicWriteStream,
  createPreparedAtomicWriteStream,
  download as fsDownload,
  ensureDir,
  exists,
  hash,
  isSameFile,
  mkdir as fsMkdir,
  move as fsMove,
  PathStaleVersionError,
  prepareAtomicWrite,
  probeReadable,
  read,
  readChunk,
  remove as fsRemove,
  removeDir,
  shouldSilenceFsyncDirError,
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
    const s = await stat(f as AbsoluteFilePath)
    expect(s.size).toBe('hello world'.length)
    expect(s.isDirectory).toBe(false)
    expect(s.modifiedAt).toBeGreaterThan(0)
    expect(s.createdAt).toBeGreaterThan(0)
  })

  it('returns isDirectory=true for a directory', async () => {
    const d = path.join(tmp, 'sub')
    await mkdir(d)
    const s = await stat(d as AbsoluteFilePath)
    expect(s.isDirectory).toBe(true)
  })

  it('throws ENOENT for missing path', async () => {
    await expect(stat(path.join(tmp, 'missing') as AbsoluteFilePath)).rejects.toThrow(/ENOENT/)
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
    expect(await exists(f as AbsoluteFilePath)).toBe(true)
  })

  it('returns true for an existing directory', async () => {
    expect(await exists(tmp as AbsoluteFilePath)).toBe(true)
  })

  it('returns false for a missing path', async () => {
    expect(await exists(path.join(tmp, 'nope') as AbsoluteFilePath)).toBe(false)
  })
})

describe('probeReadable', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it("returns 'readable' for an existing readable path", async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFile(f, 'x')
    expect(await probeReadable(f as AbsoluteFilePath)).toBe('readable')
  })

  it("returns 'missing' for a genuinely absent path (ENOENT)", async () => {
    expect(await probeReadable(path.join(tmp, 'nope') as AbsoluteFilePath)).toBe('missing')
  })

  it("returns 'unverifiable' for a non-ENOENT failure", async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFile(f, 'x')
    // Treating a regular file as a directory parent yields ENOTDIR, not ENOENT, so the probe must
    // report it as unverifiable rather than missing.
    expect(await probeReadable(path.join(f, 'child') as AbsoluteFilePath)).toBe('unverifiable')
  })
})

describe('shouldSilenceFsyncDirError', () => {
  // Pin the silent-vs-warn boundary that atomicWriteFile / createAtomicWriteStream
  // rely on for post-rename durability observability. The list shifted in
  // c9127b7c3 (EPERM/EACCES moved from silent → warn); a future maintainer
  // re-adding either would silence a real ACL-drift regression on user machines.
  it('silences EINVAL / EISDIR / ENOTSUP (filesystems that semantically reject dir fsync)', () => {
    expect(shouldSilenceFsyncDirError('EINVAL')).toBe(true)
    expect(shouldSilenceFsyncDirError('EISDIR')).toBe(true)
    expect(shouldSilenceFsyncDirError('ENOTSUP')).toBe(true)
  })

  it('does NOT silence permission errnos (EPERM / EACCES) — real ACL/sandbox regressions', () => {
    expect(shouldSilenceFsyncDirError('EPERM')).toBe(false)
    expect(shouldSilenceFsyncDirError('EACCES')).toBe(false)
  })

  it('does NOT silence real IO errnos (EIO / ENOSPC / others)', () => {
    expect(shouldSilenceFsyncDirError('EIO')).toBe(false)
    expect(shouldSilenceFsyncDirError('ENOSPC')).toBe(false)
    expect(shouldSilenceFsyncDirError('ENOENT')).toBe(false)
    expect(shouldSilenceFsyncDirError(undefined)).toBe(false)
  })
})

describe('isSameFile', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns true when both arguments refer to the same on-disk file', async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFile(f, 'x')
    expect(await isSameFile(f as AbsoluteFilePath, f as AbsoluteFilePath)).toBe(true)
  })

  it('returns true for a hardlink (different paths, same inode) — the real dev+ino check', async () => {
    // Hardlink is the cross-platform stand-in for the case-only-rename
    // scenario (case-insensitive FS) — two paths, one inode. A future
    // refactor that compares paths or non-(dev, ino) metadata would fail here.
    const { link } = await import('node:fs/promises')
    const f = path.join(tmp, 'orig.txt')
    const linked = path.join(tmp, 'hardlinked.txt')
    await writeFile(f, 'x')
    await link(f, linked)
    expect(await isSameFile(f as AbsoluteFilePath, linked as AbsoluteFilePath)).toBe(true)
  })

  it('returns false for two distinct files even with identical content', async () => {
    const a = path.join(tmp, 'one.txt')
    const b = path.join(tmp, 'two.txt')
    await writeFile(a, 'same')
    await writeFile(b, 'same')
    expect(await isSameFile(a as AbsoluteFilePath, b as AbsoluteFilePath)).toBe(false)
  })

  it('returns false when one path is missing (ENOENT — the expected miss)', async () => {
    const real = path.join(tmp, 'real.txt')
    await writeFile(real, 'x')
    const ghost = path.join(tmp, 'ghost.txt')
    expect(await isSameFile(real as AbsoluteFilePath, ghost as AbsoluteFilePath)).toBe(false)
    expect(await isSameFile(ghost as AbsoluteFilePath, real as AbsoluteFilePath)).toBe(false)
  })

  it('returns false when both paths are missing', async () => {
    const a = path.join(tmp, 'ghost-a.txt')
    const b = path.join(tmp, 'ghost-b.txt')
    expect(await isSameFile(a as AbsoluteFilePath, b as AbsoluteFilePath)).toBe(false)
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
    const out = await read(f as AbsoluteFilePath)
    expect(out).toBe('你好 hello')
  })

  it('reads with explicit text encoding option', async () => {
    const f = path.join(tmp, 't2.txt')
    await writeFile(f, 'plain', 'utf-8')
    const out = await read(f as AbsoluteFilePath, { encoding: 'text' })
    expect(out).toBe('plain')
  })

  it('throws ENOENT on missing path', async () => {
    await expect(read(path.join(tmp, 'missing') as AbsoluteFilePath)).rejects.toThrow(/ENOENT/)
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
    const out = await read(f as AbsoluteFilePath, { encoding: 'base64' })
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
    const out = await read(f as AbsoluteFilePath, { encoding: 'binary' })
    expect(out.data).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(out.data).equals(Buffer.from(bytes))).toBe(true)
    expect(out.mime).toBe('application/pdf')
  })
})

describe('readChunk', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-fs-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('reads the requested byte range', async () => {
    const file = path.join(tmp, 'bytes.bin')
    await writeFile(file, new Uint8Array([0, 1, 2, 3, 4, 5]))

    const chunk = await readChunk(file as AbsoluteFilePath, 2, 3)

    expect(Array.from(chunk)).toEqual([2, 3, 4])
  })

  it('continues reading while advancing buffer and file positions across non-EOF short reads', async () => {
    const file = path.join(tmp, 'bytes.bin')
    await writeFile(file, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))

    const handle = await open(file, 'r')
    const fileHandlePrototype = Object.getPrototypeOf(handle) as {
      read: (
        buffer: Uint8Array,
        bufferOffset: number,
        length: number,
        position: number
      ) => Promise<{ bytesRead: number; buffer: Uint8Array }>
    }
    const originalRead = fileHandlePrototype.read
    await handle.close()
    const shortReadLengths = [2, 1, 2]

    const readSpy = vi.spyOn(fileHandlePrototype, 'read').mockImplementation(function (
      this: unknown,
      buffer: Uint8Array,
      bufferOffset: number,
      length: number,
      position: number
    ) {
      return originalRead.call(
        this,
        buffer,
        bufferOffset,
        Math.min(length, shortReadLengths.shift() ?? length),
        position
      )
    })

    try {
      const chunk = await readChunk(file as AbsoluteFilePath, 10, 5)

      expect(Array.from(chunk)).toEqual([10, 11, 12, 13, 14])
      expect(readSpy).toHaveBeenNthCalledWith(1, expect.any(Uint8Array), 0, 5, 10)
      expect(readSpy).toHaveBeenNthCalledWith(2, expect.any(Uint8Array), 2, 3, 12)
      expect(readSpy).toHaveBeenNthCalledWith(3, expect.any(Uint8Array), 3, 2, 13)
    } finally {
      readSpy.mockRestore()
    }
  })

  it('returns a tightly-backed short read at EOF', async () => {
    const file = path.join(tmp, 'bytes.bin')
    await writeFile(file, new Uint8Array([0, 1, 2, 3]))

    const chunk = await readChunk(file as AbsoluteFilePath, 2, 8)

    expect(Array.from(chunk)).toEqual([2, 3])
    expect(chunk.buffer.byteLength).toBe(chunk.byteLength)
  })

  it('returns an empty tightly-backed array when the offset is at or beyond EOF', async () => {
    const file = path.join(tmp, 'bytes.bin')
    await writeFile(file, new Uint8Array([0, 1, 2, 3]))

    for (const offset of [4, 10]) {
      const chunk = await readChunk(file as AbsoluteFilePath, offset, 2)
      expect(chunk.byteLength).toBe(0)
      expect(chunk.buffer.byteLength).toBe(0)
    }
  })

  it('throws for a missing path', async () => {
    await expect(readChunk(path.join(tmp, 'missing.bin') as AbsoluteFilePath, 0, 4)).rejects.toThrow(/ENOENT/)
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
    const h1 = await hash(f1 as AbsoluteFilePath)
    const h2 = await hash(f2 as AbsoluteFilePath)
    expect(h1).toBe(h2)
  })

  it('returns different hashes for different content', async () => {
    const f1 = path.join(tmp, 'a.txt')
    const f2 = path.join(tmp, 'b.txt')
    await writeFile(f1, 'hello world')
    await writeFile(f2, 'goodbye world')
    expect(await hash(f1 as AbsoluteFilePath)).not.toBe(await hash(f2 as AbsoluteFilePath))
  })

  it('returns a tagged lowercase XXH3-64 hash', async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFile(f, 'sample')
    const h = await hash(f as AbsoluteFilePath)
    expect(h).toMatch(/^xxh3-64:[0-9a-f]{16}$/)
  })

  it('returns the same tagged digest as the in-memory content hasher', async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFile(f, 'sample')
    const h = await hash(f as AbsoluteFilePath)
    expect(h).toBe('xxh3-64:06a58212247c13bb')
  })

  it('matches the canonical XXH3-64 fixture for "hello"', async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFile(f, 'hello')
    const h = await hash(f as AbsoluteFilePath)
    expect(h).toBe('xxh3-64:9555e8555c62dcfd')
  })

  it('rejects without hashing when the abort signal is already aborted', async () => {
    const f = path.join(tmp, 'a.txt')
    await writeFile(f, 'hello')
    const signal = AbortSignal.abort(new DOMException('hash cancelled', 'AbortError'))
    await expect(hash(f as AbsoluteFilePath, signal)).rejects.toThrow('hash cancelled')
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
    const target = path.join(tmp, 'a.txt') as AbsoluteFilePath
    await atomicWriteFile(target, 'hello')
    expect(await readFile(target, 'utf-8')).toBe('hello')
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('writes Uint8Array content', async () => {
    const target = path.join(tmp, 'b.bin') as AbsoluteFilePath
    const data = new Uint8Array([0x01, 0x02, 0x03])
    await atomicWriteFile(target, data)
    const buf = await readFile(target)
    expect(Buffer.from(buf).equals(Buffer.from(data))).toBe(true)
  })

  it('overwrites an existing target atomically', async () => {
    const target = path.join(tmp, 'c.txt') as AbsoluteFilePath
    await atomicWriteFile(target, 'first')
    await atomicWriteFile(target, 'second')
    expect(await readFile(target, 'utf-8')).toBe('second')
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('applies options.mode from creation (never on disk under a looser mode)', async () => {
    if (process.platform === 'win32') return
    const target = path.join(tmp, 'secret.txt') as AbsoluteFilePath
    await atomicWriteFile(target, 'sk-secret', { mode: 0o600 })
    expect(await readFile(target, 'utf-8')).toBe('sk-secret')
    expect((await fsStatPromise(target)).mode & 0o777).toBe(0o600)
  })

  it('tightens a pre-existing looser target mode on overwrite', async () => {
    if (process.platform === 'win32') return
    const target = path.join(tmp, 'was-open.txt') as AbsoluteFilePath
    await writeFile(target, 'old', { mode: 0o644 })
    await atomicWriteFile(target, 'new-secret', { mode: 0o600 })
    expect(await readFile(target, 'utf-8')).toBe('new-secret')
    expect((await fsStatPromise(target)).mode & 0o777).toBe(0o600)
  })

  it('keeps the default (umask) mode when options.mode is omitted', async () => {
    if (process.platform === 'win32') return
    const target = path.join(tmp, 'plain.txt') as AbsoluteFilePath
    await atomicWriteFile(target, 'hello')
    // Same 0666 & ~umask a plain fs write gets — no accidental tightening.
    const reference = path.join(tmp, 'reference.txt')
    await writeFile(reference, 'hello')
    expect((await fsStatPromise(target)).mode & 0o777).toBe((await fsStatPromise(reference)).mode & 0o777)
  })

  it('cleans up the tmp file when rename fails', async () => {
    // Make the target directory read-only after pre-creating an existing file there,
    // then attempt to overwrite — rename(tmp → target) cannot succeed because the
    // directory is read-only on POSIX. Skip on Windows where chmod semantics differ.
    if (process.platform === 'win32') return
    const target = path.join(tmp, 'd.txt') as AbsoluteFilePath
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

describe('PreparedAtomicWrite', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-prepared-write-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('derives size and hash from the prepared bytes and commits idempotently', async () => {
    const target = path.join(tmp, 'prepared.bin') as AbsoluteFilePath
    await writeFile(target, 'old')
    const bytes = new Uint8Array([1, 2, 3, 4])

    const prepared = await prepareAtomicWrite(target, bytes)
    expect(prepared).toMatchObject({
      target,
      size: bytes.byteLength,
      contentHash: hashContent(bytes),
      state: 'prepared'
    })
    expect(await readFile(target, 'utf-8')).toBe('old')

    const firstVersion = await prepared.commit()
    expect(prepared.state).toBe('committed')
    expect(Array.from(await readFile(target))).toEqual(Array.from(bytes))
    await expect(prepared.commit()).resolves.toEqual(firstVersion)
    await expect(prepared.abort()).resolves.toBeUndefined()
  })

  it('aborts idempotently without replacing the target and cannot commit afterward', async () => {
    const target = path.join(tmp, 'aborted.txt') as AbsoluteFilePath
    await writeFile(target, 'old')
    const prepared = await prepareAtomicWrite(target, 'new')

    await prepared.abort()
    await prepared.abort()

    expect(prepared.state).toBe('aborted')
    expect(await readFile(target, 'utf-8')).toBe('old')
    expect((await readdir(tmp)).filter((entry) => entry.includes('.tmp-'))).toEqual([])
    await expect(prepared.commit()).rejects.toThrow(/already aborted/)
  })

  it('serializes concurrent commit and abort calls onto one terminal transition', async () => {
    const target = path.join(tmp, 'concurrent.txt') as AbsoluteFilePath
    await writeFile(target, 'old')
    const prepared = await prepareAtomicWrite(target, 'new')

    const [firstVersion, secondVersion] = await Promise.all([
      prepared.commit(),
      prepared.commit(),
      prepared.abort().then(() => undefined)
    ])

    expect(firstVersion).toEqual(secondVersion)
    expect(prepared.state).toBe('committed')
    expect(await readFile(target, 'utf-8')).toBe('new')
    expect((await readdir(tmp)).filter((entry) => entry.includes('.tmp-'))).toEqual([])
  })

  it('incrementally hashes stream chunks and leaves commit under caller control', async () => {
    const target = path.join(tmp, 'stream.bin') as AbsoluteFilePath
    const bytes = Buffer.from('incremental payload')
    let prepared: Awaited<ReturnType<typeof prepareAtomicWrite>> | undefined
    const stream = createPreparedAtomicWriteStream(target, async (result) => {
      prepared = result
    })

    stream.write(bytes.subarray(0, 5))
    stream.end(bytes.subarray(5))
    await new Promise<void>((resolve, reject) => {
      stream.once('finish', resolve)
      stream.once('error', reject)
    })

    expect(prepared).toMatchObject({
      size: bytes.byteLength,
      contentHash: hashContent(bytes),
      state: 'prepared'
    })
    expect(await exists(target)).toBe(false)
    await prepared!.commit()
    expect(await readFile(target)).toEqual(bytes)
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
    const target = path.join(tmp, 'a.txt') as AbsoluteFilePath
    await writeFile(target, 'first')
    const s = await fsStatPromise(target)
    const expected = { mtime: Math.floor(s.mtimeMs), size: s.size }
    const next = await atomicWriteIfUnchanged(target, 'second', expected)
    expect(await readFile(target, 'utf-8')).toBe('second')
    expect(next.size).toBe(6)
    expect(next.mtime).toBeGreaterThanOrEqual(expected.mtime)
  })

  it('throws PathStaleVersionError when size differs', async () => {
    const target = path.join(tmp, 'b.txt') as AbsoluteFilePath
    await writeFile(target, 'twelve chars')
    const expected = { mtime: 0, size: 1 }
    await expect(atomicWriteIfUnchanged(target, 'next', expected)).rejects.toBeInstanceOf(PathStaleVersionError)
    expect(await readFile(target, 'utf-8')).toBe('twelve chars')
  })

  it('throws PathStaleVersionError when mtime differs', async () => {
    const target = path.join(tmp, 'c.txt') as AbsoluteFilePath
    await writeFile(target, 'same-size')
    const expected = { mtime: 12345, size: 'same-size'.length }
    await expect(atomicWriteIfUnchanged(target, 'next-size', expected)).rejects.toBeInstanceOf(PathStaleVersionError)
    expect(await readFile(target, 'utf-8')).toBe('same-size')
  })

  it('treats second-precision mtime + same size as match (ambiguous branch)', async () => {
    const target = path.join(tmp, 'd.txt') as AbsoluteFilePath
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
    const target = path.join(tmp, 'd2.txt') as AbsoluteFilePath
    await writeFile(target, 'aaaa')
    await utimes(target, 1700000001, 1700000001) // current is 1700000001 sec
    const expected = { mtime: 1700000000_000, size: 4 } // expected was 1700000000 sec
    await expect(atomicWriteIfUnchanged(target, 'bbbb', expected)).rejects.toBeInstanceOf(PathStaleVersionError)
    expect(await readFile(target, 'utf-8')).toBe('aaaa')
  })

  it('with expectedContentHash, throws when hash differs in ambiguous branch', async () => {
    const target = path.join(tmp, 'e.txt') as AbsoluteFilePath
    await writeFile(target, 'aaaa')
    await utimes(target, 1700000000, 1700000000)
    const expected = { mtime: 1700000000_000, size: 4 }
    const wrongHash = ContentHashSchema.parse(`xxh3-64:${'0'.repeat(16)}`)
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
    const target = path.join(tmp, 'a.txt') as AbsoluteFilePath
    await fsWrite(target, 'hello')
    expect(await readFile(target, 'utf-8')).toBe('hello')
  })

  it('overwrites existing target without leaving tmp residue', async () => {
    const target = path.join(tmp, 'b.txt') as AbsoluteFilePath
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
    await fsCopy(src as AbsoluteFilePath, dest as AbsoluteFilePath)
    expect(await readFile(dest, 'utf-8')).toBe('payload')
    expect(await readFile(src, 'utf-8')).toBe('payload')
  })

  it('overwrites an existing dest atomically (no tmp residue)', async () => {
    const src = path.join(tmp, 'src.txt')
    const dest = path.join(tmp, 'dest.txt')
    await writeFile(src, 'new')
    await writeFile(dest, 'old')
    await fsCopy(src as AbsoluteFilePath, dest as AbsoluteFilePath)
    expect(await readFile(dest, 'utf-8')).toBe('new')
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('preserves binary content byte-for-byte', async () => {
    const src = path.join(tmp, 'src.bin')
    const dest = path.join(tmp, 'dest.bin')
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x20, 0x80])
    await writeFile(src, bytes)
    await fsCopy(src as AbsoluteFilePath, dest as AbsoluteFilePath)
    const out = await readFile(dest)
    expect(out.equals(bytes)).toBe(true)
  })

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const src = path.join(tmp, 'src.txt')
    const dest = path.join(tmp, 'dest.txt')
    await writeFile(src, 'payload')
    const controller = new AbortController()
    controller.abort()
    await expect(fsCopy(src as AbsoluteFilePath, dest as AbsoluteFilePath, controller.signal)).rejects.toThrow(/abort/i)
    // No partial dest committed (rename only on successful finish) and no tmp residue.
    expect(await exists(dest as AbsoluteFilePath)).toBe(false)
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('interrupts an in-flight copy when aborted (no tmp residue, dest not committed)', async () => {
    const src = path.join(tmp, 'big.bin')
    const dest = path.join(tmp, 'dest.bin')
    // Large enough that the copy is still streaming when we abort on the same tick.
    await writeFile(src, Buffer.alloc(16 * 1024 * 1024))
    const controller = new AbortController()
    const pending = fsCopy(src as AbsoluteFilePath, dest as AbsoluteFilePath, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(/abort/i)
    expect(await exists(dest as AbsoluteFilePath)).toBe(false)
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
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
    await fsMove(src as AbsoluteFilePath, dest as AbsoluteFilePath)
    expect(await exists(src as AbsoluteFilePath)).toBe(false)
    expect(await readFile(dest, 'utf-8')).toBe('payload')
  })

  it('moves across nested directories within the same mount', async () => {
    const sub = path.join(tmp, 'a', 'b')
    await mkdir(sub, { recursive: true })
    const src = path.join(tmp, 'src.txt')
    const dest = path.join(sub, 'dest.txt')
    await writeFile(src, 'payload')
    await fsMove(src as AbsoluteFilePath, dest as AbsoluteFilePath)
    expect(await exists(src as AbsoluteFilePath)).toBe(false)
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
    const target = path.join(tmp, 'a.txt') as AbsoluteFilePath
    await writeFile(target, 'x')
    await fsRemove(target)
    expect(await exists(target)).toBe(false)
  })

  it('is idempotent on a missing path (no throw)', async () => {
    const target = path.join(tmp, 'nope.txt') as AbsoluteFilePath
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
    const target = path.join(tmp, 'a') as AbsoluteFilePath
    await fsMkdir(target)
    const s = await stat(target)
    expect(s.isDirectory).toBe(true)
  })

  it('ensureDir creates a deeply nested path and is idempotent', async () => {
    const target = path.join(tmp, 'a', 'b', 'c') as AbsoluteFilePath
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
    await removeDir(root as AbsoluteFilePath)
    expect(await exists(root as AbsoluteFilePath)).toBe(false)
  })

  it('removeDir is idempotent on a missing path', async () => {
    await expect(removeDir(path.join(tmp, 'nope') as AbsoluteFilePath)).resolves.toBeUndefined()
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
    const dest = path.join(tmp, 'out.bin') as AbsoluteFilePath
    await fsDownload(`${baseUrl}/file.bin`, dest)
    const buf = await readFile(dest)
    expect(Array.from(buf)).toEqual([0x01, 0x02, 0x03])
  })

  it('throws and leaves no dest file on a non-2xx response', async () => {
    routes.set('/missing', { status: 404, body: 'gone' })
    const dest = path.join(tmp, 'out.bin') as AbsoluteFilePath
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
    const target = path.join(tmp, 'a.txt') as AbsoluteFilePath
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
    const target = path.join(tmp, 'b.txt') as AbsoluteFilePath
    const stream = createAtomicWriteStream(target)
    stream.write('partial')
    await stream.abort()
    expect(await exists(target)).toBe(false)
    const entries = await readdir(tmp)
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('cleans up tmp file when destroyed with an error', async () => {
    const target = path.join(tmp, 'c.txt') as AbsoluteFilePath
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
