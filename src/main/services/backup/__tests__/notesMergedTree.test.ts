// t5 — Merged Notes tree construction (dir-swap producer side). The merged tree unions the
// live tree (local-only preserved) with the backup tree (backup-only added); same-path
// conflicts resolve local-first (local kept, backup dropped + disclosed).
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildMergedNotesTreeSync } from '../notesMergedTree'

describe('buildMergedNotesTree (t5 dir-swap producer)', () => {
  let dir: string
  let backupTree: string
  let liveRoot: string
  let mergedDir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cs-merged-tree-'))
    backupTree = join(dir, 'backup-notes')
    liveRoot = join(dir, 'live-notes')
    mergedDir = join(dir, 'merged')
    await mkdir(backupTree, { recursive: true })
    await mkdir(liveRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const write = async (root: string, rel: string, content: string): Promise<void> => {
    const full = join(root, rel)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, content)
  }

  it('keeps local-only notes and adds backup-only notes', async () => {
    await write(liveRoot, 'local-only.md', '# local')
    await write(backupTree, 'backup-only.md', '# backup')
    const result = await buildMergedNotesTreeSync(backupTree, liveRoot, mergedDir, ['backup-only.md'])

    expect(await readFile(join(mergedDir, 'local-only.md'), 'utf8')).toBe('# local')
    expect(await readFile(join(mergedDir, 'backup-only.md'), 'utf8')).toBe('# backup')
    expect(result.conflicts).toEqual([])
    expect(result.treeHash).toMatch(/^sha256-merkle-v1:[0-9a-f]{64}$/)
  })

  it('keeps local content on a same-path conflict + discloses the dropped backup note', async () => {
    await write(liveRoot, 'shared.md', '# LOCAL')
    await write(backupTree, 'shared.md', '# BACKUP')
    const result = await buildMergedNotesTreeSync(backupTree, liveRoot, mergedDir, ['shared.md'])

    expect(await readFile(join(mergedDir, 'shared.md'), 'utf8')).toBe('# LOCAL')
    expect(result.conflicts).toEqual([{ relPath: 'shared.md', reason: 'same_path_different_content' }])
  })

  it('treats identical same-path notes as a no-op (no conflict)', async () => {
    await write(liveRoot, 'same.md', '# same')
    await write(backupTree, 'same.md', '# same')
    const result = await buildMergedNotesTreeSync(backupTree, liveRoot, mergedDir, ['same.md'])
    expect(result.conflicts).toEqual([])
    expect(await readFile(join(mergedDir, 'same.md'), 'utf8')).toBe('# same')
  })

  it('merges nested subtrees from both sides', async () => {
    await write(liveRoot, 'sub/local.md', '# l')
    await write(backupTree, 'sub/backup.md', '# b')
    await write(backupTree, 'other/deep.md', '# d')
    await buildMergedNotesTreeSync(backupTree, liveRoot, mergedDir, ['sub/backup.md', 'other/deep.md'])
    expect(await readFile(join(mergedDir, 'sub/local.md'), 'utf8')).toBe('# l')
    expect(await readFile(join(mergedDir, 'sub/backup.md'), 'utf8')).toBe('# b')
    expect(await readFile(join(mergedDir, 'other/deep.md'), 'utf8')).toBe('# d')
  })

  it('builds a pure backup tree when the live root is absent (fresh install)', async () => {
    await rm(liveRoot, { recursive: true, force: true })
    await write(backupTree, 'fresh.md', '# fresh')
    const result = await buildMergedNotesTreeSync(backupTree, liveRoot, mergedDir, ['fresh.md'])
    expect(await readFile(join(mergedDir, 'fresh.md'), 'utf8')).toBe('# fresh')
    expect(result.conflicts).toEqual([])
  })

  it('skips backup relPaths with a ".." segment (containment guard)', async () => {
    await write(backupTree, 'safe.md', '# safe')
    const result = await buildMergedNotesTreeSync(backupTree, liveRoot, mergedDir, ['safe.md', '../escape.md'])
    expect(await readFile(join(mergedDir, 'safe.md'), 'utf8')).toBe('# safe')
    // escape never written
    expect(result.conflicts).toEqual([])
  })
})
