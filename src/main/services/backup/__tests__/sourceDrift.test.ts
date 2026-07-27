import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { access, appendFile, chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { driftHooks, stageDirectoryWithDriftCheck, stageFileWithDriftCheck } from '../sourceDrift'

let dir: string
let srcDir: string
let stageDir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bk-drift-'))
  srcDir = path.join(dir, 'src')
  stageDir = path.join(dir, 'stage')
  await mkdir(srcDir, { recursive: true })
})
afterEach(async () => {
  driftHooks.afterStagePreVerify = async () => {}
  driftHooks.afterInitialLstat = async () => {}
  await rm(dir, { recursive: true, force: true })
})

async function src(rel: string, content: string): Promise<string> {
  const abs = path.join(srcDir, rel)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, content)
  return abs
}

describe('stageFileWithDriftCheck', () => {
  it('stages a regular file, returns its sha256 + size, and copies content', async () => {
    const source = await src('a.txt', 'hello world')
    const staging = path.join(stageDir, 'a.txt')
    const result = await stageFileWithDriftCheck({ sourcePath: source, stagingPath: staging })
    expect(result.size).toBe(11)
    expect(result.hash).toBe(createHash('sha256').update('hello world').digest('hex'))
    expect(await readFile(staging, 'utf8')).toBe('hello world')
  })

  it('enforces the per-entry byte ceiling before creating any staging output', async () => {
    const source = await src('big.txt', 'ABCDE') // 5 bytes
    const staging = path.join(stageDir, 'big.txt')
    await expect(
      stageFileWithDriftCheck({ sourcePath: source, stagingPath: staging, maxEntryBytes: 2 })
    ).rejects.toThrow(/entry-bytes|ceiling/)
    expect(existsSync(staging)).toBe(false)
  })

  it('rejects a symlink source and leaves no staged file', async () => {
    await src('real.txt', 'x')
    const linkPath = path.join(srcDir, 'link.txt')
    await symlink(path.join(srcDir, 'real.txt'), linkPath)
    const staging = path.join(stageDir, 'link.txt')
    await expect(stageFileWithDriftCheck({ sourcePath: linkPath, stagingPath: staging })).rejects.toThrow(
      /symlink or special/
    )
    expect(existsSync(staging)).toBe(false)
  })

  it('never truncates a pre-existing staging file (exclusive create; foreign data survives)', async () => {
    const source = await src('a.txt', 'new-content')
    const staging = path.join(stageDir, 'a.txt')
    await mkdir(stageDir, { recursive: true })
    await writeFile(staging, 'PRE-EXISTING-FOREIGN')
    await expect(stageFileWithDriftCheck({ sourcePath: source, stagingPath: staging })).rejects.toThrow()
    expect(await readFile(staging, 'utf8')).toBe('PRE-EXISTING-FOREIGN')
  })

  it('does NOT stage external bytes when the source is swapped for a symlink between lstat and open', async () => {
    const source = await src('a.txt', 'inside-bytes')
    const external = path.join(dir, 'external-secret.txt')
    await writeFile(external, 'EXTERNAL-SECRET')
    const staging = path.join(stageDir, 'a.txt')
    driftHooks.afterInitialLstat = async () => {
      await rm(source)
      await symlink(external, source) // swap the path to a symlink pointing outside
    }
    await expect(stageFileWithDriftCheck({ sourcePath: source, stagingPath: staging })).rejects.toThrow()
    expect(existsSync(staging)).toBe(false) // identity gate fires before any dest write
  })

  it('fails closed and removes staging when the source drifts during staging', async () => {
    const source = await src('a.txt', 'original')
    const staging = path.join(stageDir, 'a.txt')
    driftHooks.afterStagePreVerify = async (p) => {
      await appendFile(p, 'MORE')
    }
    await expect(stageFileWithDriftCheck({ sourcePath: source, stagingPath: staging })).rejects.toThrow(
      /changed during staging/
    )
    expect(existsSync(staging)).toBe(false)
  })

  it('detects a SAME-SIZE content rewrite during staging (not just size changes)', async () => {
    const source = await src('a.txt', 'AAAA')
    const staging = path.join(stageDir, 'a.txt')
    driftHooks.afterStagePreVerify = async (p) => {
      await writeFile(p, 'BBBB') // identical size, different bytes → mtime/ctime move
    }
    await expect(stageFileWithDriftCheck({ sourcePath: source, stagingPath: staging })).rejects.toThrow(
      /changed during staging/
    )
    expect(existsSync(staging)).toBe(false)
  })

  it('detects a metadata-only change via ctime (size + mtime + content all unchanged)', async () => {
    const source = await src('a.txt', 'AAAA')
    const staging = path.join(stageDir, 'a.txt')
    driftHooks.afterStagePreVerify = async (p) => {
      await chmod(p, 0o640) // changes ONLY ctime — proves ctimeNs participates in the identity gate
    }
    await expect(stageFileWithDriftCheck({ sourcePath: source, stagingPath: staging })).rejects.toThrow(
      /changed during staging/
    )
    expect(existsSync(staging)).toBe(false)
  })

  it('honors a pre-aborted signal and stages nothing', async () => {
    const source = await src('a.txt', 'x')
    const staging = path.join(stageDir, 'a.txt')
    const ac = new AbortController()
    ac.abort()
    await expect(
      stageFileWithDriftCheck({ sourcePath: source, stagingPath: staging, signal: ac.signal })
    ).rejects.toThrow(/cancelled/)
    expect(existsSync(staging)).toBe(false)
  })

  it('cancels mid-stream and leaves no staged file (non-flaky: also fine if it finished first)', async () => {
    const big = 'z'.repeat(512 * 1024)
    const source = await src('big.bin', big)
    const staging = path.join(stageDir, 'big.bin')
    const ac = new AbortController()
    const p = stageFileWithDriftCheck({ sourcePath: source, stagingPath: staging, signal: ac.signal })
    ac.abort()
    try {
      await p
      expect(existsSync(staging)).toBe(true)
    } catch (err) {
      expect((err as Error).name).toBe('BackupCancelledError')
      expect(existsSync(staging)).toBe(false)
    }
  })
})

describe('stageDirectoryWithDriftCheck', () => {
  it('stages a regular-file tree with per-file hashes and sorted relPaths', async () => {
    await src('b/2.txt', 'two')
    await src('a/1.txt', 'one')
    const { files } = await stageDirectoryWithDriftCheck({ sourceDir: srcDir, stagingDir: stageDir })
    expect(files.map((f) => f.relPath)).toEqual(['a/1.txt', 'b/2.txt'])
    expect(await readFile(path.join(stageDir, 'a/1.txt'), 'utf8')).toBe('one')
    expect(await readFile(path.join(stageDir, 'b/2.txt'), 'utf8')).toBe('two')
  })

  it('INCLUDES .cherry index artifacts by default; excludes them only when opted in', async () => {
    await src('doc.md', 'body')
    await src('.cherry/index.sqlite', 'INDEX')

    const included = await stageDirectoryWithDriftCheck({ sourceDir: srcDir, stagingDir: stageDir })
    expect(included.files.map((f) => f.relPath).sort()).toEqual(['.cherry/index.sqlite', 'doc.md'])

    const stage2 = path.join(dir, 'stage2')
    const excluded = await stageDirectoryWithDriftCheck({
      sourceDir: srcDir,
      stagingDir: stage2,
      excludeKnowledgeDerivedIndex: true
    })
    expect(excluded.files.map((f) => f.relPath)).toEqual(['doc.md'])
    expect(existsSync(path.join(stage2, '.cherry/index.sqlite'))).toBe(false)
  })

  it('detects an intermediate directory swapped between the scan and a later file copy', async () => {
    await src('a/1.txt', 'one')
    await src('b/2.txt', 'two')
    driftHooks.afterStagePreVerify = async (p) => {
      // While staging a/1.txt, swap directory `b` for a fresh inode BEFORE b/2.txt copies.
      if (p.endsWith(path.join('a', '1.txt'))) {
        await rename(path.join(srcDir, 'b'), path.join(srcDir, 'b_old'))
        await mkdir(path.join(srcDir, 'b'))
        await writeFile(path.join(srcDir, 'b', '2.txt'), 'two')
      }
    }
    await expect(stageDirectoryWithDriftCheck({ sourceDir: srcDir, stagingDir: stageDir })).rejects.toThrow(/ancestor/)
    await expect(access(stageDir)).rejects.toThrow() // owned staging removed
  })

  it('rejects a symlink anywhere in the tree', async () => {
    await src('real.txt', 'x')
    await symlink(path.join(srcDir, 'real.txt'), path.join(srcDir, 'link.txt'))
    await expect(stageDirectoryWithDriftCheck({ sourceDir: srcDir, stagingDir: stageDir })).rejects.toThrow(
      /symlink or special/
    )
  })

  it('rejects a symlinked source root', async () => {
    await src('inner.txt', 'x')
    const linkRoot = path.join(dir, 'linkroot')
    await symlink(srcDir, linkRoot)
    await expect(stageDirectoryWithDriftCheck({ sourceDir: linkRoot, stagingDir: stageDir })).rejects.toThrow(
      /symlink or special/
    )
  })

  it('refuses a pre-existing staging dir and leaves it (and its sentinel) intact', async () => {
    await src('a.txt', 'x')
    await mkdir(stageDir, { recursive: true })
    await writeFile(path.join(stageDir, 'sentinel'), 'KEEP-ME')
    await expect(stageDirectoryWithDriftCheck({ sourceDir: srcDir, stagingDir: stageDir })).rejects.toThrow(
      /already exists/
    )
    expect(await readFile(path.join(stageDir, 'sentinel'), 'utf8')).toBe('KEEP-ME')
  })

  it('fails closed on final-rescan drift (a file appears during staging) and removes owned staging', async () => {
    await src('a.txt', 'a')
    await src('z.txt', 'z')
    driftHooks.afterStagePreVerify = async (p) => {
      if (p.endsWith('z.txt')) await writeFile(path.join(srcDir, 'sneaky.txt'), 'new')
    }
    await expect(stageDirectoryWithDriftCheck({ sourceDir: srcDir, stagingDir: stageDir })).rejects.toThrow(
      /tree changed during staging/
    )
    await expect(access(stageDir)).rejects.toThrow() // owned staging removed
  })

  it('honors a pre-aborted signal', async () => {
    await src('a.txt', 'x')
    const ac = new AbortController()
    ac.abort()
    await expect(
      stageDirectoryWithDriftCheck({ sourceDir: srcDir, stagingDir: stageDir, signal: ac.signal })
    ).rejects.toThrow(/cancelled/)
  })
})
