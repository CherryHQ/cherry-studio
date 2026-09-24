import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_DIR_SCAN_LIMITS, scanDirectoryUnit } from '../dirScan'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bk-scan-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(dir, rel)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, content)
}

describe('scanDirectoryUnit — safe portable scan', () => {
  it('returns entries + directory identities (bigint) and a dir+file entry count', async () => {
    await write('b/2.txt', 'two')
    await write('a/1.txt', 'one')
    const scan = await scanDirectoryUnit(dir)
    expect(scan.entries.map((e) => e.relPath)).toEqual(['a/1.txt', 'b/2.txt'])
    expect(scan.dirs.map((d) => d.relPath)).toEqual(['a', 'b'])
    expect(typeof scan.dirs[0].id.ino).toBe('bigint')
    expect(typeof scan.rootId.mtimeNs).toBe('bigint')
    expect(scan.entryCount).toBe(4) // 2 dirs + 2 files
    expect(scan.totalBytes).toBe(BigInt('one'.length + 'two'.length)) // aggregate file bytes (bigint)
  })

  it('validates DIRECTORY names too — an empty reserved-name dir is rejected', async () => {
    await mkdir(path.join(dir, 'con'), { recursive: true }) // empty dir, reserved on Windows
    await expect(scanDirectoryUnit(dir)).rejects.toThrow(/not portable/)
  })

  it('counts directories against the entry ceiling (not just files)', async () => {
    await mkdir(path.join(dir, 'd1'), { recursive: true })
    await mkdir(path.join(dir, 'd2'), { recursive: true }) // 2 dirs, 0 files
    const limits = { ...DEFAULT_DIR_SCAN_LIMITS, maxEntries: 1 }
    await expect(scanDirectoryUnit(dir, { limits })).rejects.toThrow(/entry-count/)
  })

  it('rejects a symlinked root and a symlink within', async () => {
    await write('real/inner.txt', 'x')
    const linkRoot = path.join(dir, 'linkroot')
    await symlink(path.join(dir, 'real'), linkRoot)
    await expect(scanDirectoryUnit(linkRoot)).rejects.toThrow(/symlink or special/)
  })

  it('materializes an internal file link into the virtual archive tree', async () => {
    await write('targets/source.txt', 'inside')
    await symlink('targets/source.txt', path.join(dir, 'alias.txt'))

    const scan = await scanDirectoryUnit(dir, { mode: 'capture', capturePolicy: {} })

    expect(scan.entries.map(({ relPath, sourceRelPath }) => ({ relPath, sourceRelPath }))).toEqual([
      { relPath: 'alias.txt', sourceRelPath: 'targets/source.txt' },
      { relPath: 'targets/source.txt', sourceRelPath: 'targets/source.txt' }
    ])
    expect(scan.links).toMatchObject([
      {
        relPath: 'alias.txt',
        sourceRelPath: 'alias.txt',
        linkTarget: 'targets/source.txt',
        targetRelPath: 'targets/source.txt'
      }
    ])
    expect(scan.omissions).toEqual([])
  })

  it('expands an acyclic internal link chain', async () => {
    await write('target.txt', 'inside')
    await symlink('target.txt', path.join(dir, 'inner.txt'))
    await symlink('inner.txt', path.join(dir, 'outer.txt'))

    const scan = await scanDirectoryUnit(dir, { mode: 'capture', capturePolicy: {} })

    expect(scan.entries.map(({ relPath, sourceRelPath }) => ({ relPath, sourceRelPath }))).toEqual([
      { relPath: 'inner.txt', sourceRelPath: 'target.txt' },
      { relPath: 'outer.txt', sourceRelPath: 'target.txt' },
      { relPath: 'target.txt', sourceRelPath: 'target.txt' }
    ])
    expect(scan.omissions).toEqual([])
  })

  it('materializes an internal directory link and keeps its virtual descendants', async () => {
    await write('targets/nested/source.txt', 'inside')
    await symlink('targets', path.join(dir, 'alias'))

    const scan = await scanDirectoryUnit(dir, { mode: 'capture', capturePolicy: {} })

    expect(scan.entries.map(({ relPath, sourceRelPath }) => ({ relPath, sourceRelPath }))).toContainEqual({
      relPath: 'alias/nested/source.txt',
      sourceRelPath: 'targets/nested/source.txt'
    })
    expect(scan.dirs.map(({ relPath, sourceRelPath }) => ({ relPath, sourceRelPath }))).toContainEqual({
      relPath: 'alias',
      sourceRelPath: 'targets'
    })
    expect(scan.links.map((link) => link.relPath)).toContain('alias')
  })

  it('omits an external link without losing ordinary siblings', async () => {
    const external = path.join(path.dirname(dir), `${path.basename(dir)}-external.txt`)
    await writeFile(external, 'outside')
    await write('kept.txt', 'inside')
    await symlink(external, path.join(dir, 'external.txt'))

    try {
      const scan = await scanDirectoryUnit(dir, { mode: 'capture', capturePolicy: {} })

      expect(scan.entries.map((entry) => entry.relPath)).toEqual(['kept.txt'])
      expect(scan.omissions).toMatchObject([
        { relPath: 'external.txt', sourceRelPath: 'external.txt', reason: 'external-reference' }
      ])
    } finally {
      await rm(external, { force: true })
    }
  })

  it('stops at an external intermediate link instead of resolving its missing target', async () => {
    const missingExternalDir = path.join(path.dirname(dir), `${path.basename(dir)}-missing`)
    await symlink(missingExternalDir, path.join(dir, 'escape'))
    await symlink('escape/secret.txt', path.join(dir, 'through-escape.txt'))

    const scan = await scanDirectoryUnit(dir, { mode: 'capture', capturePolicy: {} })

    expect(scan.omissions.map(({ relPath, reason }) => ({ relPath, reason }))).toEqual([
      { relPath: 'escape', reason: 'external-reference' },
      { relPath: 'through-escape.txt', reason: 'external-reference' }
    ])
  })

  it('classifies dangling and cyclic link edges without rejecting the tree', async () => {
    await mkdir(path.join(dir, 'nested'))
    await symlink('missing.txt', path.join(dir, 'dangling.txt'))
    await symlink('..', path.join(dir, 'nested', 'back'))

    const scan = await scanDirectoryUnit(dir, { mode: 'capture', capturePolicy: {} })

    expect(scan.omissions.map(({ relPath, reason }) => ({ relPath, reason }))).toEqual([
      { relPath: 'dangling.txt', reason: 'dangling-reference' },
      { relPath: 'nested/back', reason: 'cyclic-reference' }
    ])
    expect(scan.dirs.map((entry) => entry.relPath)).toEqual(['nested'])
  })

  it('enforces the entry-count ceiling incrementally', async () => {
    await write('a.txt', 'a')
    await write('b.txt', 'b')
    const limits = { ...DEFAULT_DIR_SCAN_LIMITS, maxEntries: 1 }
    await expect(scanDirectoryUnit(dir, { limits })).rejects.toThrow(/entry-count/)
  })

  it('enforces the per-entry byte ceiling', async () => {
    await write('big.bin', 'x'.repeat(100))
    const limits = { ...DEFAULT_DIR_SCAN_LIMITS, maxEntryBytes: 10 }
    await expect(scanDirectoryUnit(dir, { limits })).rejects.toThrow(/entry-bytes/)
  })

  it('enforces the total-uncompressed ceiling', async () => {
    await write('a.bin', 'x'.repeat(60))
    await write('b.bin', 'y'.repeat(60))
    const limits = { ...DEFAULT_DIR_SCAN_LIMITS, maxTotalBytes: 100 }
    await expect(scanDirectoryUnit(dir, { limits })).rejects.toThrow(/total-bytes/)
  })

  it('is cancellable', async () => {
    await write('a.txt', 'x')
    const ac = new AbortController()
    ac.abort()
    await expect(scanDirectoryUnit(dir, { signal: ac.signal })).rejects.toThrow(/cancelled/)
  })

  it('rejects a case/NFC collision (files and dirs share ONE namespace) when the FS preserves both', async () => {
    await write('Foo.txt', 'a')
    let bothKept = true
    try {
      await writeFile(path.join(dir, 'foo.txt'), 'b')
      const names = (await readdir(dir)).filter((n) => n.toLowerCase() === 'foo.txt')
      bothKept = names.length === 2
    } catch {
      bothKept = false
    }
    if (!bothKept) return // case-insensitive FS collapsed them; nothing to reject on disk
    await expect(scanDirectoryUnit(dir)).rejects.toThrow(/collides/)
  })
})
