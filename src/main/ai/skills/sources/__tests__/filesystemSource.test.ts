import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'

import { filesystemSource } from '../filesystemSource'

const SKILL_BODY = `# Code review

Read the diff. Look for security issues.
`

const skillFile = (name: string, description = 'desc') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${SKILL_BODY}`

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fs-source-test-'))
})

afterEach(() => {
  MockMainCacheServiceUtils.resetMocks()
  rmSync(root, { recursive: true, force: true })
})

function makeSkillDir(folderName: string, content: string): string {
  const dir = join(root, folderName)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, 'SKILL.md')
  writeFileSync(filePath, content)
  return filePath
}

describe('filesystemSource', () => {
  /**
   * Two valid skill folders + one folder whose SKILL.md is malformed
   * (parse returns null). The source must return only the two valid
   * Skills, each tagged with the supplied source id, and silently
   * drop the malformed one. Mirrors the resilience contract from
   * `collectStatic`: one bad file does not abort the others.
   */
  it('scans a directory, tags each Skill with the source id, drops parse failures', async () => {
    makeSkillDir('alpha', skillFile('alpha'))
    makeSkillDir('beta', skillFile('beta'))
    makeSkillDir('broken', '---\ndescription: missing name\n---\nbody') // no name → null

    const out = await filesystemSource({ rootDir: root, sourceId: 'cherry-global' })
    const names = out.map((s) => s.name).sort()
    expect(names).toEqual(['alpha', 'beta'])
    expect(out.every((s) => s.source === 'cherry-global')).toBe(true)
  })

  /**
   * Opt-in source dirs (~/.claude/skills, ~/.codex/skills, etc.) may
   * not exist on the user's machine. A throw here would break every
   * agent session for users without those dirs configured.
   */
  it('returns an empty array when the source directory does not exist', async () => {
    const out = await filesystemSource({ rootDir: join(root, 'does-not-exist'), sourceId: 'agent-global' })
    expect(out).toEqual([])
  })

  /**
   * Layer 1 cache contract via observable behavior. Pre-seed the
   * cache with a fake parsed Skill keyed by the SKILL.md path; assert
   * the source returns the fake (proves cache was consulted). Bump
   * mtime; assert the source re-reads from disk and returns the real
   * parsed Skill. Asserting return values rather than fs spy counts
   * keeps the test stable under cache-storage refactors.
   */
  it('uses the per-file cache when mtime is unchanged; refreshes when mtime advances', async () => {
    const filePath = makeSkillDir('cached-skill', skillFile('on-disk', 'real disk content'))
    // Cache keys use realpath so seeded entries survive `/var` →
    // `/private/var` resolution on macOS.
    const canonicalPath = realpathSync(filePath)
    const stat1 = statSync(canonicalPath)

    // Seed cache with a fake parsed Skill paired with the file's
    // current mtime. Correct cache-honoring impl returns the fake.
    MockMainCacheServiceUtils.setCacheValue(`skills.parsed.${canonicalPath}`, {
      mtimeMs: stat1.mtimeMs,
      skill: {
        id: 'fake',
        name: 'cached-fake',
        description: 'served from cache',
        body: 'cached body',
        source: 'cherry-global',
        path: canonicalPath,
        contentHash: 'fakehash'
      }
    })

    const cached = await filesystemSource({ rootDir: root, sourceId: 'cherry-global' })
    expect(cached.map((s) => s.name)).toEqual(['cached-fake'])

    // Bump mtime; cache miss → re-read from disk
    const future = new Date(stat1.mtimeMs + 5000)
    utimesSync(canonicalPath, future, future)

    const refreshed = await filesystemSource({ rootDir: root, sourceId: 'cherry-global' })
    expect(refreshed.map((s) => s.name)).toEqual(['on-disk'])
  })

  /**
   * Layer 0 — realpath cache. When `<root>/<folder>/SKILL.md` is a
   * symlink that gets retargeted between two scans, the second scan
   * must surface the new target's path, not the cached old realpath.
   * This guards a subtle bug class: a stale realpath cache lets two
   * sources keep referring to a deleted physical file even after the
   * symlink farm changed.
   */
  it('detects symlink retargets and returns the updated realpath', async () => {
    const targetA = join(root, 'real-a')
    const targetB = join(root, 'real-b')
    mkdirSync(targetA, { recursive: true })
    mkdirSync(targetB, { recursive: true })
    writeFileSync(join(targetA, 'SKILL.md'), skillFile('linked', 'pointing to A'))
    writeFileSync(join(targetB, 'SKILL.md'), skillFile('linked', 'pointing to B'))

    const linksDir = join(root, 'links')
    mkdirSync(linksDir, { recursive: true })
    const linkPath = join(linksDir, 'linked')
    symlinkSync(targetA, linkPath, 'dir')

    const before = await filesystemSource({ rootDir: linksDir, sourceId: 'cherry-global' })
    expect(before).toHaveLength(1)
    // Compare against realpath since macOS resolves `/var` → `/private/var`
    expect(before[0].path).toBe(realpathSync(join(targetA, 'SKILL.md')))

    // Retarget the symlink; mtime of the link itself changes
    rmSync(linkPath, { force: true })
    symlinkSync(targetB, linkPath, 'dir')

    const after = await filesystemSource({ rootDir: linksDir, sourceId: 'cherry-global' })
    expect(after).toHaveLength(1)
    expect(after[0].path).toBe(realpathSync(join(targetB, 'SKILL.md')))
  })
})
