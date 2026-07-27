import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { durability, fsyncParentDirsBatched } from '../fsyncBatch'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bk-fsync-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

async function file(rel: string): Promise<string> {
  const abs = path.join(dir, rel)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, 'x')
  return abs
}

describe('fsyncParentDirsBatched', () => {
  it('fsyncs each distinct parent directory exactly once, regardless of file count', async () => {
    const spy = vi.spyOn(durability, 'fsyncDir').mockResolvedValue()
    // 6 files across 2 distinct parent directories.
    const files = [
      await file('a/1'),
      await file('a/2'),
      await file('a/3'),
      await file('b/1'),
      await file('b/2'),
      await file('b/3')
    ]
    const { fsyncedDirs } = await fsyncParentDirsBatched(files)
    expect(spy).toHaveBeenCalledTimes(2) // bound = distinct parents, NOT 6 files
    expect(fsyncedDirs).toEqual([path.join(dir, 'a'), path.join(dir, 'b')])
  })

  it('scales fsync count with distinct parents (100 files in 1 dir → 1 fsync)', async () => {
    const spy = vi.spyOn(durability, 'fsyncDir').mockResolvedValue()
    const files: string[] = []
    for (let i = 0; i < 100; i++) files.push(await file(`one/${i}`))
    await fsyncParentDirsBatched(files)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an empty set', async () => {
    const spy = vi.spyOn(durability, 'fsyncDir').mockResolvedValue()
    const { fsyncedDirs } = await fsyncParentDirsBatched([])
    expect(spy).not.toHaveBeenCalled()
    expect(fsyncedDirs).toEqual([])
  })
})
