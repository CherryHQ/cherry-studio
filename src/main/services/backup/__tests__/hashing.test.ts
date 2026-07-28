import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  fileSizeBytes,
  hashDirectoryUnit,
  hashStreamHooks,
  isKnowledgeDerivedIndexPath,
  sha256File,
  sha256FileCancellable
} from '../hashing'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bk-hash-'))
})
afterEach(async () => {
  hashStreamHooks.onChunk = () => {}
  await rm(dir, { recursive: true, force: true })
})

async function write(rel: string, content: string): Promise<string> {
  const abs = path.join(dir, rel)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, content)
  return abs
}

describe('sha256File / fileSizeBytes', () => {
  it('produces the 64-hex sha256 of file bytes and its size', async () => {
    const abs = await write('a.txt', 'hello')
    const expected = createHash('sha256').update('hello').digest('hex')
    expect(await sha256File(abs)).toBe(expected)
    expect(await fileSizeBytes(abs)).toBe(5)
  })
})

describe('sha256FileCancellable', () => {
  it('matches the plain digest when not cancelled', async () => {
    const abs = await write('a.txt', 'hello')
    expect(await sha256FileCancellable(abs)).toBe(createHash('sha256').update('hello').digest('hex'))
  })

  it('aborts deterministically after the stream has begun (per-chunk check)', async () => {
    const abs = await write('big.bin', 'z'.repeat(512 * 1024))
    const ac = new AbortController()
    let chunks = 0
    hashStreamHooks.onChunk = () => {
      chunks++
      if (chunks === 1) ac.abort()
    }
    await expect(sha256FileCancellable(abs, ac.signal)).rejects.toThrow(/cancelled/)
    expect(chunks).toBeGreaterThanOrEqual(1)
  })

  it('rejects a pre-aborted signal without hashing', async () => {
    const abs = await write('a.txt', 'x')
    const ac = new AbortController()
    ac.abort()
    await expect(sha256FileCancellable(abs, ac.signal)).rejects.toThrow(/cancelled/)
  })
})

describe('isKnowledgeDerivedIndexPath', () => {
  it('matches ONLY the exact unit-root Knowledge index artifacts', () => {
    expect(isKnowledgeDerivedIndexPath('.cherry/index.sqlite')).toBe(true)
    expect(isKnowledgeDerivedIndexPath('.cherry/index.sqlite-wal')).toBe(true)
    expect(isKnowledgeDerivedIndexPath('.cherry/index.sqlite-shm')).toBe(true)
    // Nested / non-root .cherry content is authoritative and NOT matched.
    expect(isKnowledgeDerivedIndexPath('base-1/.cherry/index.sqlite')).toBe(false)
    expect(isKnowledgeDerivedIndexPath('sub/.cherry/index.sqlite')).toBe(false)
    expect(isKnowledgeDerivedIndexPath('.cherry/other.db')).toBe(false)
    expect(isKnowledgeDerivedIndexPath('index.sqlite')).toBe(false)
  })
})

describe('hashDirectoryUnit', () => {
  it('is deterministic and independent of file creation order', async () => {
    await write('b/2.txt', 'two')
    await write('a/1.txt', 'one')
    const first = await hashDirectoryUnit(dir)

    const dir2 = await mkdtemp(path.join(tmpdir(), 'bk-hash2-'))
    try {
      await mkdir(path.join(dir2, 'a'), { recursive: true })
      await mkdir(path.join(dir2, 'b'), { recursive: true })
      await writeFile(path.join(dir2, 'a', '1.txt'), 'one')
      await writeFile(path.join(dir2, 'b', '2.txt'), 'two')
      const second = await hashDirectoryUnit(dir2)
      expect(second.hash).toBe(first.hash)
      expect(second.files.map((f) => f.relPath)).toEqual(['a/1.txt', 'b/2.txt'])
    } finally {
      await rm(dir2, { recursive: true, force: true })
    }
  })

  it('authenticates nested empty directories', async () => {
    const withoutEmpty = (await hashDirectoryUnit(dir)).hash
    await mkdir(path.join(dir, 'empty', 'nested'), { recursive: true })
    const withEmpty = (await hashDirectoryUnit(dir)).hash

    expect(withEmpty).not.toBe(withoutEmpty)
  })

  it('changes when content changes', async () => {
    await write('a.txt', 'one')
    const h1 = (await hashDirectoryUnit(dir)).hash
    await write('a.txt', 'ONE')
    const h2 = (await hashDirectoryUnit(dir)).hash
    expect(h2).not.toBe(h1)
  })

  it('is sensitive to the path/content boundary (framing is unambiguous)', async () => {
    const t1 = await mkdtemp(path.join(tmpdir(), 'bk-fr1-'))
    const t2 = await mkdtemp(path.join(tmpdir(), 'bk-fr2-'))
    try {
      await writeFile(path.join(t1, 'ab'), 'X')
      await writeFile(path.join(t2, 'a'), 'bX')
      expect((await hashDirectoryUnit(t1)).hash).not.toBe((await hashDirectoryUnit(t2)).hash)
    } finally {
      await rm(t1, { recursive: true, force: true })
      await rm(t2, { recursive: true, force: true })
    }
  })

  it('INCLUDES .cherry index artifacts by default (no silent authoritative-file drop)', async () => {
    await write('doc.md', 'body')
    await write('.cherry/index.sqlite', 'INDEX')
    const result = await hashDirectoryUnit(dir)
    expect(result.files.map((f) => f.relPath).sort()).toEqual(['.cherry/index.sqlite', 'doc.md'])
  })

  it('excludes .cherry index artifacts ONLY when the caller opts in (and only at the unit root)', async () => {
    await write('doc.md', 'body')
    const withoutIndex = await hashDirectoryUnit(dir, { excludeKnowledgeDerivedIndex: true })
    await write('.cherry/index.sqlite', 'INDEX')
    await write('.cherry/index.sqlite-wal', 'WAL')
    const withIndexExcluded = await hashDirectoryUnit(dir, { excludeKnowledgeDerivedIndex: true })
    expect(withIndexExcluded.hash).toBe(withoutIndex.hash)
    expect(withIndexExcluded.files.map((f) => f.relPath)).toEqual(['doc.md'])
  })

  it('does NOT exclude a NESTED .cherry index even when opted in (authoritative)', async () => {
    await write('sub/.cherry/index.sqlite', 'NESTED')
    const result = await hashDirectoryUnit(dir, { excludeKnowledgeDerivedIndex: true })
    expect(result.files.map((f) => f.relPath)).toEqual(['sub/.cherry/index.sqlite'])
  })

  it('rejects a symlink inside the unit', async () => {
    await write('real.txt', 'x')
    await symlink(path.join(dir, 'real.txt'), path.join(dir, 'link.txt'))
    await expect(hashDirectoryUnit(dir)).rejects.toThrow(/symlink or special/)
  })

  it('rejects a symlinked unit root', async () => {
    const realRoot = await write('real/inner.txt', 'x')
    const linkRoot = path.join(dir, 'linkroot')
    await symlink(path.dirname(realRoot), linkRoot)
    await expect(hashDirectoryUnit(linkRoot)).rejects.toThrow(/symlink or special/)
  })

  it('is cancellable before streaming (pre-aborted)', async () => {
    await write('a.txt', 'x')
    const ac = new AbortController()
    ac.abort()
    await expect(hashDirectoryUnit(dir, { signal: ac.signal })).rejects.toThrow(/cancelled/)
  })

  it('is cancellable AFTER a large-file stream has begun (per-chunk check)', async () => {
    await write('big.bin', 'z'.repeat(512 * 1024)) // multiple 64 KiB chunks
    const ac = new AbortController()
    let chunks = 0
    hashStreamHooks.onChunk = () => {
      chunks++
      if (chunks === 1) ac.abort() // abort mid-stream; next chunk's check rejects
    }
    await expect(hashDirectoryUnit(dir, { signal: ac.signal })).rejects.toThrow(/cancelled/)
    expect(chunks).toBeGreaterThanOrEqual(1)
  })
})
