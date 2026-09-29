import fs from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AbsoluteFilePathSchema } from '@shared/types/file'

import { getFileIdentity, removeDir, writeInPlace } from '../fs'

describe('file mutation primitives', () => {
  let root: string

  beforeEach(async () => {
    const tempRoot = path.join(process.cwd(), '.context', 'vitest-temp')
    await fs.mkdir(tempRoot, { recursive: true })
    root = await fs.mkdtemp(path.join(tempRoot, 'file-mutation-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('writes through hard links without replacing the file identity', async () => {
    const original = AbsoluteFilePathSchema.parse(path.join(root, 'original.txt'))
    const alias = AbsoluteFilePathSchema.parse(path.join(root, 'alias.txt'))
    await fs.writeFile(original, 'old content')
    await fs.link(original, alias)
    const identity = await getFileIdentity(original)

    await writeInPlace(alias, '新内容')

    expect(identity).toBeDefined()
    expect(await getFileIdentity(original)).toBe(identity)
    expect(await getFileIdentity(alias)).toBe(identity)
    expect(await fs.readFile(original, 'utf-8')).toBe('新内容')
  })

  it('creates a missing file and persists binary bytes exactly', async () => {
    const target = AbsoluteFilePathSchema.parse(path.join(root, 'new.bin'))
    const data = new Uint8Array([0, 255, 128, 10])
    await writeInPlace(target, data)
    expect(await fs.readFile(target)).toEqual(Buffer.from(data))
  })

  it('distinguishes separate files with the same content and missing paths', async () => {
    const a = AbsoluteFilePathSchema.parse(path.join(root, 'a.txt'))
    const b = AbsoluteFilePathSchema.parse(path.join(root, 'b.txt'))
    await fs.writeFile(a, 'same')
    await fs.writeFile(b, 'same')
    expect(await getFileIdentity(a)).not.toBe(await getFileIdentity(b))
    await fs.unlink(b)
    expect(await getFileIdentity(b)).toBeUndefined()
  })

  it('refuses to remove a nonempty directory and preserves its child', async () => {
    const dir = AbsoluteFilePathSchema.parse(path.join(root, 'dir'))
    await fs.mkdir(dir)
    await fs.writeFile(path.join(dir, 'child.txt'), 'keep')
    await expect(removeDir(dir, { recursive: false })).rejects.toThrow()
    expect(await fs.readFile(path.join(dir, 'child.txt'), 'utf-8')).toBe('keep')
    await fs.unlink(path.join(dir, 'child.txt'))
    await removeDir(dir, { recursive: false })
    await expect(fs.stat(dir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(removeDir(dir, { recursive: false })).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
