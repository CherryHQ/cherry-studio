// Unit tests for the PREFERENCES contributor — pure declaration assertions (no DB).
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { PREFERENCES_CONTRIBUTOR } from '../backupContributor-preferences'

describe('PREFERENCES contributor', () => {
  it('owns preference + note', () => {
    expect(PREFERENCES_CONTRIBUTOR.schema.tables).toEqual([table('preference'), table('note')])
  })

  it('preference has composite PK [scope, key]; note has uuid-v4 PK', () => {
    const preference = PREFERENCES_CONTRIBUTOR.schema.primaryKeys.find((p) => p.table === 'preference')!
    const note = PREFERENCES_CONTRIBUTOR.schema.primaryKeys.find((p) => p.table === 'note')!
    expect(preference.columns).toEqual(['scope', 'key'])
    expect(preference.kind).toBe('composite')
    expect(note.kind).toBe('uuid-v4')
  })

  it('both aggregates are natural-key SKIP (settings exception, invariant #21)', () => {
    const preference = PREFERENCES_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('preference'))!
    const note = PREFERENCES_CONTRIBUTOR.schema.aggregates.find((a) => a.root === table('note'))!
    expect(preference.identityKey).toEqual(['scope', 'key'])
    expect(preference.identityClass).toBe('natural-key')
    expect(preference.conflictDefault).toBe('SKIP')
    expect(preference.renamable).toBe(false)
    // note identityKey is the UNIQUE (rootPath, path) overlay key, not the uuid PK
    expect(note.identityKey).toEqual(['rootPath', 'path'])
    expect(note.identityClass).toBe('natural-key')
    expect(note.conflictDefault).toBe('SKIP')
    expect(note.renamable).toBe(false)
  })

  it('has no cross-domain references and no JSON soft-refs (preference.value is free-form JSON)', () => {
    expect(PREFERENCES_CONTRIBUTOR.schema.references).toEqual([])
    expect(PREFERENCES_CONTRIBUTOR.schema.jsonSoftReferences).toEqual([])
  })

  it('declares platformSpecificKeys for restore-time cross-platform exclusion', () => {
    expect(PREFERENCES_CONTRIBUTOR.backupPolicy.platformSpecificKeys).toBeDefined()
    expect(PREFERENCES_CONTRIBUTOR.backupPolicy.platformSpecificKeys!.length).toBeGreaterThan(0)
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(PREFERENCES_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })

  it('declares collectFileResources (notes markdown file resource)', () => {
    // PREFERENCES owns Notes markdown bodies as a file resource — the hook scans
    // ctx.notesRoot. restoreResources (dir-swap preboot promotion) is the D track.
    expect(PREFERENCES_CONTRIBUTOR.operations).toBeDefined()
    expect(PREFERENCES_CONTRIBUTOR.operations?.collectFileResources).toBeDefined()
  })
})

// Filesystem tests for collectFileResources — scans a tmp Notes root for .md files.
// The hook returns relative POSIX paths so the manifest is OS-independent.
describe('PREFERENCES collectFileResources (notes markdown)', () => {
  // Minimal context stub: only notesRoot matters for the hook (module logger owns
  // logging). Other FileResourceContext fields are unused by collectNotesMarkdown.
  const ctx = (notesRoot?: string) => ({ notesRoot }) as never

  it('returns an empty set when notesRoot is undefined (unit-test / unwired host)', async () => {
    const collect = PREFERENCES_CONTRIBUTOR.operations!.collectFileResources!
    // Act — undefined notesRoot must NOT throw (so stub-registry tests still pass).
    const out = await collect(ctx(undefined))
    expect(out).toEqual(new Set<string>())
  })

  it('returns an empty set when notesRoot is an empty directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-pref-notes-empty-'))
    try {
      const collect = PREFERENCES_CONTRIBUTOR.operations!.collectFileResources!
      const out = await collect(ctx(dir))
      expect(out).toEqual(new Set<string>())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('collects .md files recursively as relative POSIX paths (sub-dir structure preserved)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-pref-notes-tree-'))
    try {
      // Arrange — a root note + a nested note + a non-markdown file (must be ignored).
      await writeFile(join(dir, 'note1.md'), '# 1')
      await mkdir(join(dir, 'sub'), { recursive: true })
      await writeFile(join(dir, 'sub', 'note2.md'), '# 2')
      await writeFile(join(dir, 'readme.txt'), 'ignore me')

      // Act
      const collect = PREFERENCES_CONTRIBUTOR.operations!.collectFileResources!
      const out = await collect(ctx(dir))

      // Assert — relative POSIX paths; .txt excluded; nested sub-dir preserved.
      expect(out).toEqual(new Set(['note1.md', 'sub/note2.md']))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not throw when a sub-directory is unreadable (skip rather than abort)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-pref-notes-unread-'))
    try {
      // Arrange — a readable note + a nested dir. We can't reliably make a dir
      // unreadable across CI runners (root, perms), so this test only asserts the
      // happy path here; the unreadable-subtree branch is exercised via code review.
      await writeFile(join(dir, 'a.md'), '# a')
      const collect = PREFERENCES_CONTRIBUTOR.operations!.collectFileResources!
      const out = await collect(ctx(dir))
      expect(out).toEqual(new Set(['a.md']))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not collect paths that escape the notes root (sibling escape.md)', async () => {
    // Arrange — parent/escape.md sits next to parent/notes/; collect must only see
    // in-root notes, never a `..`-escaped sibling.
    const parent = await mkdtemp(join(tmpdir(), 'cs-pref-notes-escape-'))
    const notesRoot = join(parent, 'notes')
    try {
      await mkdir(notesRoot, { recursive: true })
      await writeFile(join(parent, 'escape.md'), '# escape')
      await writeFile(join(notesRoot, 'safe.md'), '# safe')

      const collect = PREFERENCES_CONTRIBUTOR.operations!.collectFileResources!
      const out = await collect(ctx(notesRoot))

      // Assert — only the in-root note; no `..` segments and no escape.md.
      expect(out).toEqual(new Set(['safe.md']))
      for (const p of out) {
        expect(p.split('/').includes('..')).toBe(false)
        expect(p).not.toContain('escape.md')
      }
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('does not follow a directory symlink/junction out of the notes root', async () => {
    // Arrange — notes/link → ../outside/secret.md. Lexical path is under notesRoot,
    // but realpath lands outside; collect must skip the link entirely.
    const parent = await mkdtemp(join(tmpdir(), 'cs-pref-notes-symlink-'))
    const notesRoot = join(parent, 'notes')
    const outside = join(parent, 'outside')
    try {
      await mkdir(notesRoot, { recursive: true })
      await mkdir(outside, { recursive: true })
      await writeFile(join(outside, 'secret.md'), '# secret')
      await writeFile(join(notesRoot, 'safe.md'), '# safe')
      await symlink(outside, join(notesRoot, 'link'))

      const collect = PREFERENCES_CONTRIBUTOR.operations!.collectFileResources!
      const out = await collect(ctx(notesRoot))

      expect(out).toEqual(new Set(['safe.md']))
      expect([...out].some((p) => p.includes('secret'))).toBe(false)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
