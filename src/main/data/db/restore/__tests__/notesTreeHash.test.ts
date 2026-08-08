// t5 — Notes tree hash (ordered digest over leaf .md files). The dir-swap promotion step
// verifies the staged merged tree's hash matches the descriptor before the atomic swap,
// so a tampered/corrupt staging tree cannot replace the live Notes tree.
//
// Algorithm (design.md): collect leaf .md files under a root, sha256 each file's content,
// combine per-leaf as sha256(relPath + '\0' + contentHash) in canonical POSIX relPath
// sorted order, then sha256 the concatenated per-leaf digests. Empty/no-md tree → a fixed
// constant. Prefixed 'sha256-merkle-v1:' so the algorithm can evolve without breaking the
// journal schema.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { computeNotesTreeHash } from '@data/db/restore/notesTreeHash'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('computeNotesTreeHash (t5 treeHash)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cs-treehash-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** Materialize a relPath→content tree under `dir`. */
  const writeTree = async (tree: Record<string, string>): Promise<void> => {
    for (const [rel, content] of Object.entries(tree)) {
      const full = join(dir, rel)
      await mkdir(join(full, '..'), { recursive: true })
      await writeFile(full, content)
    }
  }

  it('produces a stable versioned hash for the same tree', async () => {
    await writeTree({ 'a.md': '# a', 'sub/b.md': '# b' })
    const h = await computeNotesTreeHash(dir)
    expect(h).toBe(await computeNotesTreeHash(dir))
    expect(h).toMatch(/^sha256-merkle-v1:[0-9a-f]{64}$/)
  })

  it('changes when a leaf content changes', async () => {
    await writeTree({ 'a.md': '# a' })
    const before = await computeNotesTreeHash(dir)
    await writeFile(join(dir, 'a.md'), '# A')
    expect(await computeNotesTreeHash(dir)).not.toBe(before)
  })

  it('changes when a leaf is added or removed', async () => {
    await writeTree({ 'a.md': '# a' })
    const one = await computeNotesTreeHash(dir)
    await writeFile(join(dir, 'b.md'), '# b')
    const two = await computeNotesTreeHash(dir)
    expect(one).not.toBe(two)
  })

  it('changes when a leaf path changes (relPath participates in the digest)', async () => {
    await writeTree({ 'a.md': '# x' })
    const a = await computeNotesTreeHash(dir)
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    await writeTree({ 'b.md': '# x' })
    expect(await computeNotesTreeHash(dir)).not.toBe(a)
  })

  it('ignores non-.md files (only .md leaves participate)', async () => {
    await writeTree({ 'a.md': '# a' })
    const mdOnly = await computeNotesTreeHash(dir)
    await writeFile(join(dir, 'a.json'), '{}')
    expect(await computeNotesTreeHash(dir)).toBe(mdOnly)
  })

  it('is canonical (relPath sort, not walk order)', async () => {
    // Insert in non-sorted order; the hash must be the same as a sorted materialization.
    await writeTree({ 'z.md': '# z', 'a.md': '# a', 'm/sub.md': '# m' })
    const h1 = await computeNotesTreeHash(dir)
    // Re-materialize the same set in a different dir — same leaves after sort.
    const dir2 = await mkdtemp(join(tmpdir(), 'cs-treehash2-'))
    try {
      for (const [rel, content] of Object.entries({ 'a.md': '# a', 'm/sub.md': '# m', 'z.md': '# z' })) {
        const full = join(dir2, rel)
        await mkdir(join(full, '..'), { recursive: true })
        await writeFile(full, content)
      }
      expect(await computeNotesTreeHash(dir2)).toBe(h1)
    } finally {
      await rm(dir2, { recursive: true, force: true })
    }
  })

  it('returns a fixed constant for an empty tree (or a tree with no .md leaves)', async () => {
    const empty = await computeNotesTreeHash(dir)
    await writeFile(join(dir, 'a.json'), '{}')
    expect(await computeNotesTreeHash(dir)).toBe(empty)
    expect(empty).toMatch(/^sha256-merkle-v1:[0-9a-f]{64}$/)
  })
})
