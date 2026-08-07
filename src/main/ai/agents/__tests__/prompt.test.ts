import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('node:fs/promises', () => ({
  lstat: vi.fn(),
  open: vi.fn(),
  readdir: vi.fn(),
  realpath: vi.fn()
}))

import { lstat, open, readdir, realpath } from 'node:fs/promises'

import type { AgentConfiguration } from '@shared/data/types/agent'

import { PromptBuilder } from '../prompt'

const baseConfig: AgentConfiguration = {
  permission_mode: 'bypassPermissions',
  max_turns: 100,
  env_vars: {}
}

const mockedLstat = vi.mocked(lstat)
const mockedOpen = vi.mocked(open)
const mockedReaddir = vi.mocked(readdir)
const mockedRealpath = vi.mocked(realpath)

function setupFiles(files: Record<string, string>) {
  // Build directory listing from file paths
  const dirs = new Map<string, string[]>()
  for (const filePath of Object.keys(files)) {
    const dir = path.dirname(filePath)
    const name = path.basename(filePath)
    if (!dirs.has(dir)) dirs.set(dir, [])
    dirs.get(dir)!.push(name)

    let current = dir
    while (current !== path.dirname(current)) {
      const parent = path.dirname(current)
      if (!dirs.has(parent)) dirs.set(parent, [])
      const childName = path.basename(current)
      if (!dirs.get(parent)!.includes(childName)) dirs.get(parent)!.push(childName)
      current = parent
    }
  }

  mockedLstat.mockImplementation(async (filePath) => {
    const p = typeof filePath === 'string' ? filePath : filePath.toString()
    if (files[p] !== undefined) {
      return {
        mtimeMs: 1000,
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false
      } as any
    }
    if (dirs.has(p)) {
      return {
        mtimeMs: 1000,
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false
      } as any
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  mockedOpen.mockImplementation(async (filePath) => {
    const p = typeof filePath === 'string' ? filePath : filePath.toString()
    if (files[p] !== undefined) {
      return {
        stat: async () => ({
          mtimeMs: 1000,
          isFile: () => true
        }),
        readFile: async () => files[p],
        close: async () => undefined
      } as any
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  mockedReaddir.mockImplementation(async (dirPath) => {
    const p = typeof dirPath === 'string' ? dirPath : dirPath.toString()
    return (dirs.get(p) ?? []) as any
  })
  mockedRealpath.mockImplementation(async (targetPath) => {
    const p = typeof targetPath === 'string' ? targetPath : targetPath.toString()
    if (files[p] !== undefined || dirs.has(p)) return p
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
}

describe('PromptBuilder', () => {
  let builder: PromptBuilder

  beforeEach(() => {
    builder = new PromptBuilder()
    vi.clearAllMocks()
  })

  it('uses the SDK preset base and emits no identity preamble when no workspace files exist', async () => {
    setupFiles({})

    const { base, context: result } = await builder.buildPromptParts('/workspace')

    // No system.md → keep the Claude Code preset as the base and append Cherry content;
    // the old embedded "personal assistant" preamble must be gone.
    expect(base).toEqual({ kind: 'claude_code' })
    expect(result).not.toContain('You are a personal assistant running inside Cherry Studio')
    expect(result).toContain('## Memories')
    expect(result).toContain('`/workspace/SOUL.md`')
  })

  it('no longer embeds the always-injected tool-usage handbook (now a lazy builtin skill)', async () => {
    setupFiles({})

    const { context: result } = await builder.buildPromptParts('/workspace')

    // The autonomy / memory-handbook / web-search handbook headings and their
    // tool-strategy text ship lazily via the `cherry-tool-guide` builtin skill,
    // not baked into every prompt.
    expect(result).not.toContain('## Autonomy Tools')
    expect(result).not.toContain('## Agent Memory')
    expect(result).not.toContain('## Web Search Strategy')
    expect(result).not.toContain('mcp__cherry-tools__cron')
    expect(result).not.toContain('mcp__cherry-tools__notify')
    expect(result).not.toContain('mcp__cherry-tools__web_search')
    expect(result).not.toContain('mcp__cherry-tools__web_fetch')

    // The runtime storage contract stays: the Memories section and its memory
    // safety boundaries must survive the handbook removal.
    expect(result).toContain('## Memories')
    expect(result).toContain('mcp__agent-memory__memory')
    expect(result).toContain('Update it only through `mcp__agent-memory__memory` (action: update)')
    expect(result).toContain('Never read or write the file directly')
    expect(result).toContain('append-only log')
  })

  it('keeps an explicit system.md separate as the custom base', async () => {
    setupFiles({
      '/workspace/system.md': 'You are CustomBot, a specialized assistant.'
    })

    const { base, context: result } = await builder.buildPromptParts('/workspace')

    expect(base).toEqual({ kind: 'custom', content: 'You are CustomBot, a specialized assistant.' })
    expect(result).not.toContain('You are CustomBot')
    expect(result).toContain('## Memories')
  })

  it('treats an empty system.md as an explicit custom base while retaining Cherry context', async () => {
    setupFiles({ '/workspace/system.md': '' })

    const { base, context } = await builder.buildPromptParts('/workspace')

    expect(base).toEqual({ kind: 'custom', content: '' })
    expect(context).toContain('## Memories')
  })

  it('fails prompt construction when an explicit system.md cannot be opened', async () => {
    setupFiles({ '/workspace/system.md': 'Custom base' })
    mockedOpen.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

    await expect(builder.buildPromptParts('/workspace')).rejects.toThrow(
      'Failed to read required agent prompt file: /workspace/system.md'
    )
  })

  it('fails prompt construction when an explicit system.md cannot be read', async () => {
    setupFiles({ '/workspace/system.md': 'Custom base' })
    mockedOpen.mockResolvedValueOnce({
      stat: async () => ({ mtimeMs: 1000, isFile: () => true }),
      readFile: async () => {
        throw Object.assign(new Error('EIO'), { code: 'EIO' })
      },
      close: async () => undefined
    } as any)

    await expect(builder.buildPromptParts('/workspace')).rejects.toThrow(
      'Failed to read required agent prompt file: /workspace/system.md'
    )
  })

  it('includes soul.md in memories section', async () => {
    setupFiles({
      '/workspace/soul.md': 'Warm but direct. Lead with answers.'
    })

    const { context: result } = await builder.buildPromptParts('/workspace')

    expect(result).toContain('## Memories')
    expect(result).toContain('<soul>')
    expect(result).toContain('Warm but direct. Lead with answers.')
    expect(result).toContain('</soul>')
    expect(result).toContain('WHO you are')
  })

  it('includes user.md in memories section', async () => {
    setupFiles({
      '/workspace/user.md': 'Name: V\nTimezone: UTC+8'
    })

    const { context: result } = await builder.buildPromptParts('/workspace')

    expect(result).toContain('<user>')
    expect(result).toContain('Name: V')
    expect(result).toContain('</user>')
    expect(result).toContain('WHO the user is')
  })

  it('includes memory/FACT.md in memories section', async () => {
    setupFiles({
      '/workspace/memory/FACT.md': '# Active Projects\n\n- Cherry Studio'
    })

    const { context: result } = await builder.buildPromptParts('/workspace')

    expect(result).toContain('<facts>')
    expect(result).toContain('Cherry Studio')
    expect(result).toContain('</facts>')
    expect(result).toContain('WHAT you know')
  })

  it('includes all memory files when all exist', async () => {
    setupFiles({
      '/workspace/soul.md': 'Be concise.',
      '/workspace/user.md': 'Name: V',
      '/workspace/memory/FACT.md': 'Project: Cherry Studio'
    })

    const { context: result } = await builder.buildPromptParts('/workspace')

    expect(result).toContain('<soul>')
    expect(result).toContain('<user>')
    expect(result).toContain('<facts>')
    expect(result).toContain('Update them autonomously')
    expect(result).toContain('exclusive scope')
  })

  it('builds the memories section without the base agent prompt', async () => {
    setupFiles({
      '/workspace/SOUL.md': 'Be concise.',
      '/workspace/USER.md': 'Name: V',
      '/workspace/memory/FACT.md': 'Project: Cherry Studio'
    })

    const result = await builder.buildMemoriesSection('/workspace')

    expect(result).toContain('## Memories')
    expect(result).toContain('Be concise.')
    expect(result).toContain('Name: V')
    expect(result).toContain('Project: Cherry Studio')
    expect(result).not.toContain('You are a personal assistant running inside Cherry Studio')
    expect(result).not.toContain('## Autonomy Tools')
  })

  it('keeps system.md as the base while building memories as Cherry context', async () => {
    setupFiles({
      '/workspace/system.md': 'You are CustomBot.',
      '/workspace/soul.md': 'Sharp and efficient.'
    })

    const { base, context: result } = await builder.buildPromptParts('/workspace')

    expect(base).toEqual({ kind: 'custom', content: 'You are CustomBot.' })
    expect(result).not.toContain('You are CustomBot.')
    expect(result).toContain('<soul>')
    expect(result).toContain('Sharp and efficient.')
  })

  it('loads workspace system.md but identity and memory from the agent data directory', async () => {
    setupFiles({
      '/workspace/system.md': 'Workspace-local system prompt.',
      '/agent-data/SOUL.md': 'Persistent agent identity.',
      '/agent-data/memory/FACT.md': 'Persistent agent fact.'
    })

    const { base, context: result } = await builder.buildPromptParts('/workspace', undefined, false, '/agent-data')

    expect(base).toEqual({ kind: 'custom', content: 'Workspace-local system prompt.' })
    expect(result).not.toContain('Workspace-local system prompt.')
    expect(result).toContain('Persistent agent identity.')
    expect(result).toContain('Persistent agent fact.')
    expect(result).toContain('`/agent-data/`')
    expect(result).toContain('`/agent-data/SOUL.md`')
    expect(result).toContain('current working directory is the session workspace')
  })

  it('skips the bundled memory contract in custom mode (built-in agent with user instructions)', async () => {
    setupFiles({
      '/agent-data/SOUL.md': 'Official soul.',
      '/agent-data/USER.md': 'Official user.',
      '/agent-data/memory/FACT.md': 'Official fact.'
    })

    const { context: result } = await builder.buildPromptParts('/workspace', baseConfig, true, '/agent-data', true)

    // Custom mode: the user's prompt is the only identity — no persona, user or
    // fact files are loaded into context.
    expect(result).not.toContain('## Memories')
    expect(result).not.toContain('Official soul.')
    expect(result).not.toContain('Official user.')
    expect(result).not.toContain('Official fact.')
    expect(result).not.toContain('`/agent-data/SOUL.md`')
  })

  it('keeps the bundled memory contract outside custom mode', async () => {
    setupFiles({})

    const { context: result } = await builder.buildPromptParts('/workspace', baseConfig, true, '/agent-data', false)

    expect(result).toContain('## Memories')
    expect(result).toContain('`/agent-data/SOUL.md`')
  })

  it('always identifies the agent data directory when identity files are empty and bootstrap is skipped', async () => {
    setupFiles({})

    const { context: result } = await builder.buildPromptParts('/workspace', baseConfig, true, '/agent-data')

    expect(result).not.toContain('## Bootstrap Mode')
    expect(result).toContain('## Memories')
    expect(result).toContain('`/agent-data/SOUL.md`')
    expect(result).toContain('`/agent-data/USER.md`')
    expect(result).toContain('`/agent-data/memory/FACT.md`')
  })

  it('ignores symbolic-link persona files', async () => {
    setupFiles({ '/workspace/SOUL.md': 'must not be read' })
    mockedLstat.mockImplementation(async (filePath) => {
      const p = typeof filePath === 'string' ? filePath : filePath.toString()
      if (p === '/workspace/SOUL.md') {
        return {
          mtimeMs: 1000,
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => true
        } as any
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const { context: result } = await builder.buildPromptParts('/workspace')

    expect(result).not.toContain('must not be read')
  })

  it('resolves filenames case-insensitively', async () => {
    // Files exist with different casing than the canonical names
    setupFiles({
      '/workspace/SOUL.md': 'Uppercase soul',
      '/workspace/User.md': 'Mixed case user',
      '/workspace/memory/fact.md': 'Lowercase facts'
    })

    const { context: result } = await builder.buildPromptParts('/workspace')

    expect(result).toContain('<soul>')
    expect(result).toContain('Uppercase soul')
    expect(result).toContain('<user>')
    expect(result).toContain('Mixed case user')
    expect(result).toContain('<facts>')
    expect(result).toContain('Lowercase facts')
  })

  it('uses mtime cache for repeated reads', async () => {
    setupFiles({
      '/workspace/soul.md': 'Cached soul'
    })

    await builder.buildPromptParts('/workspace')
    await builder.buildPromptParts('/workspace')

    // The file should only be opened once due to caching.
    const soulReadCalls = mockedOpen.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('soul.md')
    )
    expect(soulReadCalls).toHaveLength(1)
  })

  describe('bootstrap mode', () => {
    it('injects bootstrap instructions when no config is provided and SOUL.md is empty', async () => {
      setupFiles({})

      const { context: result } = await builder.buildPromptParts('/workspace')

      expect(result).toContain('## Bootstrap Mode')
      expect(result).toContain('complete_bootstrap')
    })

    it('injects bootstrap instructions when bootstrap_completed is false', async () => {
      setupFiles({})

      const { context: result } = await builder.buildPromptParts('/workspace', {
        ...baseConfig,
        bootstrap_completed: false
      })

      expect(result).toContain('## Bootstrap Mode')
    })

    it('runs bootstrap when reset (bootstrap_completed false) even if the agent has instructions', async () => {
      // `config reset_bootstrap` sets bootstrap_completed=false and promises the next session onboards.
      // That explicit reset must override the instruction-based skip, or the tool's promise is a lie.
      setupFiles({})

      const { context: result } = await builder.buildPromptParts(
        '/workspace',
        { ...baseConfig, bootstrap_completed: false },
        true
      )

      expect(result).toContain('## Bootstrap Mode')
    })

    it('skips bootstrap when bootstrap_completed is true', async () => {
      setupFiles({})

      const { context: result } = await builder.buildPromptParts('/workspace', {
        ...baseConfig,
        bootstrap_completed: true
      })

      expect(result).not.toContain('## Bootstrap Mode')
    })

    it('skips bootstrap when the agent already has non-blank user instructions', async () => {
      setupFiles({})

      const { context: result } = await builder.buildPromptParts('/workspace', baseConfig, true)

      expect(result).not.toContain('## Bootstrap Mode')
    })

    it('skips bootstrap when SOUL.md has substantial content (legacy migration)', async () => {
      const realContent =
        'I am a warm, direct assistant. I lead with answers and prefer concise communication. I respect boundaries and always ask before making assumptions.'
      setupFiles({
        '/workspace/SOUL.md': `# Soul\n\n> Template header\n\n${realContent}`
      })

      const { context: result } = await builder.buildPromptParts('/workspace')

      expect(result).not.toContain('## Bootstrap Mode')
    })

    it('still shows bootstrap when SOUL.md only has template headings', async () => {
      setupFiles({
        '/workspace/SOUL.md':
          '# Soul\n\n> This file defines who you are. Update it as your personality evolves.\n\n## Personality\n\n\n## Tone\n\n'
      })

      const { context: result } = await builder.buildPromptParts('/workspace')

      expect(result).toContain('## Bootstrap Mode')
    })

    it('includes memories section alongside bootstrap instructions', async () => {
      setupFiles({
        '/workspace/SOUL.md': '# Soul\n\n> This file defines who you are.\n\n## Personality\n\n\n## Tone\n\n',
        '/workspace/user.md': 'Name: V'
      })

      const { context: result } = await builder.buildPromptParts('/workspace')

      expect(result).toContain('## Bootstrap Mode')
      expect(result).toContain('## Memories')
      expect(result).toContain('<user>')
    })
  })

  describe('buildFactsSection', () => {
    it('returns undefined when no FACT.md exists', async () => {
      setupFiles({})

      const result = await builder.buildFactsSection('/workspace')

      expect(result).toBeUndefined()
    })

    it('wraps memory/FACT.md content in an Agent Knowledge block', async () => {
      setupFiles({
        '/workspace/memory/FACT.md': '- Project: cherry-studio\n- Build tool: pnpm + electron-vite'
      })

      const result = await builder.buildFactsSection('/workspace')

      expect(result).toBeDefined()
      expect(result).toContain('## Agent Knowledge')
      expect(result).toContain('<facts>')
      expect(result).toContain('Project: cherry-studio')
      expect(result).toContain('Build tool: pnpm + electron-vite')
      expect(result).toContain('</facts>')
      // The agent should also be told to keep updating FACT.md
      expect(result).toContain('mcp__agent-memory__memory')
      expect(result).toContain('action="update"')
    })

    it('resolves FACT.md case-insensitively', async () => {
      setupFiles({
        '/workspace/memory/fact.md': '- lowercase filename'
      })

      const result = await builder.buildFactsSection('/workspace')

      expect(result).toBeDefined()
      expect(result).toContain('lowercase filename')
    })

    it('returns undefined when FACT.md exists but is empty', async () => {
      setupFiles({
        '/workspace/memory/FACT.md': ''
      })

      const result = await builder.buildFactsSection('/workspace')

      expect(result).toBeUndefined()
    })

    it('does not include SOUL.md or USER.md content (those are persona files)', async () => {
      setupFiles({
        '/workspace/SOUL.md': 'Warm but direct.',
        '/workspace/user.md': 'Name: V',
        '/workspace/memory/FACT.md': 'Build tool: pnpm'
      })

      const result = await builder.buildFactsSection('/workspace')

      expect(result).toBeDefined()
      expect(result).toContain('Build tool: pnpm')
      expect(result).not.toContain('Warm but direct')
      expect(result).not.toContain('Name: V')
      expect(result).not.toContain('<soul>')
      expect(result).not.toContain('<user>')
    })
  })
})
