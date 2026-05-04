import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { mergeSkills } from '../mergeSkills'
import type { Skill, SourceId } from '../types'

const skill = (overrides: Partial<Skill> & { name: string; source: SourceId; path: string }): Skill => ({
  id: `${overrides.source}::${overrides.name}`,
  description: 'desc',
  body: 'body',
  contentHash: 'h',
  ...overrides
})

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'merge-skills-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('mergeSkills', () => {
  /**
   * Priority direction. THREE sources of the same name (low / mid /
   * high) are needed to pin the iteration order. A two-source test
   * passes for both correct (iterate low→high, last wins) and the
   * inverted bug (iterate high→low, last wins) because the winner
   * happens to match in the two-element case. Three sources break
   * that ambiguity: only the genuinely-correct direction returns
   * the HIGH entry.
   */
  it('keeps the HIGH-priority entry when three sources collide on name', () => {
    const out = mergeSkills([
      [skill({ name: 'X', source: 'agent-global', path: '/low/X.md', body: 'low' })],
      [skill({ name: 'X', source: 'cherry-global', path: '/mid/X.md', body: 'mid' })],
      [skill({ name: 'X', source: 'workspace-cherry', path: '/high/X.md', body: 'high' })]
    ])
    expect(out).toHaveLength(1)
    expect(out[0].body).toBe('high')
    expect(out[0].source).toBe('workspace-cherry')
  })

  /**
   * Symlink dedup via real fs. Two raw paths string-different but
   * `realpath` to the same file. A naive `Set<string>` dedup that
   * compares only the raw path strings keeps both. The implementation
   * must consult the filesystem (or pre-resolved Skill.path that has
   * already been canonicalised). We exercise the real-fs path so the
   * test catches the string-only dedup bug.
   */
  it('dedupes entries that share a realpath via symlink', () => {
    const target = join(root, 'real')
    mkdirSync(target, { recursive: true })
    const realFile = join(target, 'SKILL.md')
    writeFileSync(realFile, '---\nname: shared\n---\nbody')

    const linkA = join(root, 'linkA')
    const linkB = join(root, 'linkB')
    symlinkSync(target, linkA, 'dir')
    symlinkSync(target, linkB, 'dir')

    const skillFromLinkA = skill({ name: 'shared', source: 'cherry-global', path: join(linkA, 'SKILL.md') })
    const skillFromLinkB = skill({ name: 'shared', source: 'workspace-cherry', path: join(linkB, 'SKILL.md') })

    const out = mergeSkills([[skillFromLinkA], [skillFromLinkB]])
    expect(out).toHaveLength(1)
    // Dedup must canonicalise. Whichever wins, its path resolves to the same realpath.
    // realpathSync handles macOS `/var` → `/private/var` so the comparison is symmetric.
    expect(out[0].path).toBe(realpathSync(realFile))
  })

  /**
   * Output sorted alphabetically by name. The catalog section renders
   * in this order; insertion-order output across node versions and
   * fs walk implementations would produce non-deterministic prompts
   * and bust prompt cache.
   */
  it('returns skills sorted by name alphabetically', () => {
    const out = mergeSkills([
      [
        skill({ name: 'gamma', source: 'cherry-global', path: '/g.md' }),
        skill({ name: 'alpha', source: 'cherry-global', path: '/a.md' }),
        skill({ name: 'beta', source: 'cherry-global', path: '/b.md' })
      ]
    ])
    expect(out.map((s) => s.name)).toEqual(['alpha', 'beta', 'gamma'])
  })

  /**
   * Dedup by *string* path (not realpath). Two sources hand us the
   * exact same path string for the same skill. This is the simpler
   * dedup case that a `Set<string>` covers; the symlink case above
   * requires more. Keeping both tests separate documents that the
   * implementation has both behaviours.
   */
  it('dedupes entries that share an identical path string across sources', () => {
    const sharedPath = '/shared/SKILL.md'
    const out = mergeSkills([
      [skill({ name: 'shared-name', source: 'cherry-global', path: sharedPath, body: 'low' })],
      [skill({ name: 'shared-name', source: 'workspace-cherry', path: sharedPath, body: 'high' })]
    ])
    expect(out).toHaveLength(1)
    // Higher priority still wins on dedup.
    expect(out[0].body).toBe('high')
  })
})
