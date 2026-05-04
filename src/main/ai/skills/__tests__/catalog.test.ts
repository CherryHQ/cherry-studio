import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { listCatalog } from '../catalog'

let tmpHome: string

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'skill-catalog-test-'))
  // Default all opt-ins off
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.skills.include_claude_global', false)
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.skills.include_codex_global', false)
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.skills.include_agent_global', false)
})

afterEach(() => {
  MockMainCacheServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  rmSync(tmpHome, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function makeSkillDir(parent: string, folderName: string, frontmatterName: string): void {
  const dir = join(parent, folderName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${frontmatterName}\ndescription: d\n---\nbody`)
}

describe('listCatalog', () => {
  /**
   * opt-in flag drives observable output. With the flag OFF, a skill
   * placed in `~/.claude/skills` must NOT appear in the catalog. Flip
   * the flag ON and it appears. We assert the output contents (not
   * mock call counts) so the test survives refactors that move the
   * gating between catalog.ts and registry.ts.
   */
  it('respects feature.skills.include_claude_global as a gate on the ~/.claude source', async () => {
    const claudeDir = join(tmpHome, '.claude', 'skills')
    mkdirSync(claudeDir, { recursive: true })
    makeSkillDir(claudeDir, 'claude-only', 'claude-only')

    const before = await listCatalog({ workspaceRoot: null, homeDir: tmpHome })
    expect(before.find((s) => s.name === 'claude-only')).toBeUndefined()

    MockMainPreferenceServiceUtils.setPreferenceValue('feature.skills.include_claude_global', true)
    const after = await listCatalog({ workspaceRoot: null, homeDir: tmpHome })
    expect(after.find((s) => s.name === 'claude-only')).toBeDefined()
  })

  /**
   * Workspace-scoped sources require a workspace root. With null
   * workspaceRoot, the workspace-claude and workspace-cherry sources
   * must not be queried — they have no path to scan and would either
   * throw on `join(null, ...)` or silently misbehave.
   */
  it('skips workspace-scoped sources when workspaceRoot is null', async () => {
    // Place a skill in `~/.cherry/skills` so the catalog isn't empty
    // — proves the sources that should run still run.
    const cherryGlobal = join(tmpHome, '.cherry', 'skills')
    mkdirSync(cherryGlobal, { recursive: true })
    makeSkillDir(cherryGlobal, 'global-skill', 'global-skill')

    const out = await listCatalog({ workspaceRoot: null, homeDir: tmpHome })
    // The global skill appears (workspace-less mode still loads globals)
    expect(out.find((s) => s.name === 'global-skill')).toBeDefined()
    // No workspace skills could possibly appear; we only assert the
    // call did not throw and produced the expected globals.
    expect(out.every((s) => !s.source.startsWith('workspace-'))).toBe(true)
  })
})
