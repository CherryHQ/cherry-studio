import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { atomicWriteFile, exists, hash, read, stat } from '../fs'

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
