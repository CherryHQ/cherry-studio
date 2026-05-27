import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { listDirectory } from '../search'

const writeMany = async (root: string, count: number, prefix = 'file', ext = '.txt'): Promise<string[]> => {
  const created: string[] = []
  for (let i = 0; i < count; i++) {
    const name = `${prefix}-${String(i).padStart(3, '0')}${ext}`
    const p = path.join(root, name)
    await writeFile(p, `payload ${i}`)
    created.push(p.replace(/\\/g, '/'))
  }
  return created
}

describe('listDirectory (list mode, no searchPattern)', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-search-list-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns every entry — no silent truncation at the legacy 20-cap default', async () => {
    // 75 files exercises the > 50 threshold called out in the PR plan and
    // would have been chopped to 20 under the old `maxEntries` default.
    await writeMany(tmp, 75)
    const results = await listDirectory(tmp as FilePath)
    expect(results.length).toBe(75)
  })

  it('lists nested directories and files alongside top-level entries', async () => {
    await writeFile(path.join(tmp, 'root.md'), 'root')
    await mkdir(path.join(tmp, 'sub'))
    await writeFile(path.join(tmp, 'sub', 'inner.md'), 'inner')

    const results = await listDirectory(tmp as FilePath)
    const basenames = results.map((p) => path.basename(p))
    expect(basenames).toContain('root.md')
    expect(basenames).toContain('inner.md')
    expect(basenames).toContain('sub')
  })

  it('omits hidden files by default and surfaces them when includeHidden=true', async () => {
    await writeFile(path.join(tmp, 'visible.txt'), '1')
    await writeFile(path.join(tmp, '.hidden'), '2')

    const defaultRun = await listDirectory(tmp as FilePath)
    expect(defaultRun.some((p) => p.endsWith('/.hidden'))).toBe(false)

    const withHidden = await listDirectory(tmp as FilePath, { includeHidden: true })
    expect(withHidden.some((p) => p.endsWith('/.hidden'))).toBe(true)
  })

  it('honors maxDepth=1 by skipping nested-tree contents', async () => {
    await writeFile(path.join(tmp, 'top.md'), 'top')
    await mkdir(path.join(tmp, 'sub'))
    await writeFile(path.join(tmp, 'sub', 'nested.md'), 'nested')

    const results = await listDirectory(tmp as FilePath, { maxDepth: 1 })
    const basenames = results.map((p) => path.basename(p))
    expect(basenames).toContain('top.md')
    expect(basenames).not.toContain('nested.md')
  })
})

describe('listDirectory (search mode, fuzzy + maxEntries)', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-search-search-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('caps results at the caller-supplied maxEntries', async () => {
    // 12 files share the "update" stem; caller asks for 5.
    for (let i = 0; i < 12; i++) {
      await writeFile(path.join(tmp, `updater-${i}.ts`), 'x')
    }
    const results = await listDirectory(tmp as FilePath, {
      searchPattern: 'updater',
      maxEntries: 5
    })
    expect(results.length).toBe(5)
    for (const file of results) {
      expect(path.basename(file)).toMatch(/updater/)
    }
  })

  it('ranks filename-prefix matches above unrelated paths', async () => {
    await writeFile(path.join(tmp, 'updater.ts'), 'a')
    await writeFile(path.join(tmp, 'unrelated.ts'), 'b')
    await mkdir(path.join(tmp, 'misc'))
    await writeFile(path.join(tmp, 'misc', 'inner-updater.ts'), 'c')

    const results = await listDirectory(tmp as FilePath, {
      searchPattern: 'updater',
      maxEntries: 10
    })

    expect(results[0]).toMatch(/updater\.ts$/)
    expect(results.some((p) => p.endsWith('unrelated.ts'))).toBe(false)
  })
})
