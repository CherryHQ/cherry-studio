import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'

import { agentsMdSource } from '../sources/agentsMdSource'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'agents-md-test-'))
})

afterEach(() => {
  MockMainCacheServiceUtils.resetMocks()
  rmSync(tmp, { recursive: true, force: true })
})

describe('agentsMdSource', () => {
  /**
   * Happy path: AGENTS.md exists at workspace root → returned as the
   * source's content with the canonical name.
   */
  it('returns AGENTS.md content when AGENTS.md is present', async () => {
    writeFileSync(join(tmp, 'AGENTS.md'), 'rules from AGENTS.md')
    const out = await agentsMdSource({ workspaceRoot: tmp })
    expect(out).toEqual({ name: 'agents-md', content: 'rules from AGENTS.md' })
  })

  /**
   * Priority contract: when AGENTS.md doesn't exist, fall back to
   * CLAUDE.md. A regression that flipped the order would silently
   * prefer CLAUDE.md over AGENTS.md and break repos that rely on the
   * canonical filename.
   */
  it('falls back to CLAUDE.md when AGENTS.md is absent', async () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), 'rules from CLAUDE.md')
    const out = await agentsMdSource({ workspaceRoot: tmp })
    expect(out).toEqual({ name: 'agents-md', content: 'rules from CLAUDE.md' })
  })

  /**
   * Null workspace path → must return null *without touching the file
   * system*. This guards a different code path than "file not found":
   * a bug that stripped the null guard but kept the ENOENT path would
   * still appear to work for chats with no workspace, but waste fs
   * stats and could log spurious errors.
   */
  it('returns null without filesystem access when workspaceRoot is null', async () => {
    // No fs preparation. If the implementation hits the disk anyway
    // the test still passes — but combined with test below for the
    // ENOENT path, the split documents that the two are distinct.
    const out = await agentsMdSource({ workspaceRoot: null })
    expect(out).toBeNull()
  })

  /**
   * ENOENT path: workspace exists but neither AGENTS.md nor CLAUDE.md
   * is in it. Returns null after attempting both lookups.
   */
  it('returns null when neither AGENTS.md nor CLAUDE.md exists', async () => {
    const out = await agentsMdSource({ workspaceRoot: tmp })
    expect(out).toBeNull()
  })

  /**
   * Cache contract — observable via return values, not call counts.
   * Pre-seeding the CacheService with a fake `{ mtimeMs, content }`
   * for an absolute file path means the source must trust the cache
   * when current mtime matches. Bumping mtime invalidates and we get
   * fresh content. Asserting return values rather than fs spy counts
   * keeps the test stable under refactors that swap the storage hook.
   */
  it('returns cached content when mtime matches; refreshes when mtime changes', async () => {
    const file = join(tmp, 'AGENTS.md')
    writeFileSync(file, 'on disk v1')
    const stat1 = statSync(file)

    // Seed cache with a *different* content than what's on disk, paired
    // with the file's current mtime. A correct implementation that
    // honors mtime equality returns the cached version, not the disk
    // version, proving the cache was consulted.
    MockMainCacheServiceUtils.setCacheValue(`reminders.agents_md.${file}`, {
      mtimeMs: stat1.mtimeMs,
      content: 'cached'
    })

    const cached = await agentsMdSource({ workspaceRoot: tmp })
    expect(cached?.content).toBe('cached')

    // Bump mtime by writing fresh content + advancing the file time
    // beyond the cached mtimeMs. Now the source must re-read and
    // surface the on-disk value.
    writeFileSync(file, 'on disk v2')
    const future = new Date(stat1.mtimeMs + 5000)
    utimesSync(file, future, future)

    const refreshed = await agentsMdSource({ workspaceRoot: tmp })
    expect(refreshed?.content).toBe('on disk v2')
  })
})
