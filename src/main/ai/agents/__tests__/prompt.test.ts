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

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'

import type { AgentConfiguration } from '@shared/data/types/agent'

import { PromptBuilder } from '../prompt'

const baseConfig: AgentConfiguration = {
  permission_mode: 'bypassPermissions',
  env_vars: {}
}

const mockedLstat = vi.mocked(lstat)
const mockedOpen = vi.mocked(open)
const mockedReaddir = vi.mocked(readdir)
const mockedRealpath = vi.mocked(realpath)

// Fixtures and expectations below are written with POSIX separators for
// readability, but PromptBuilder joins paths with node:path. Normalize to the
// platform separator so mock filesystem keys and expected strings match the
// joined paths on Windows too (identity on POSIX).
const posix = (posixPath: string): string => posixPath.split('/').join(path.sep)
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
    MockMainCacheServiceUtils.resetMocks()
    builder = new PromptBuilder()
    vi.clearAllMocks()
  })

  it('uses the SDK preset base when no workspace files exist', async () => {
    setupFiles({})

    const { base, context: result } = await builder.buildPromptParts(posix('/workspace'))

    expect(base).toEqual({ kind: 'native' })
    expect(result).toContain('## Memories')
    expect(result).toContain(posix('`/workspace/SOUL.md`'))
  })

  it('keeps an explicit system.md separate as the custom base', async () => {
    setupFiles({
      [posix('/workspace/system.md')]: 'You are CustomBot, a specialized assistant.'
    })

    const { base, context: result } = await builder.buildPromptParts(posix('/workspace'))

    expect(base).toEqual({ kind: 'custom', content: 'You are CustomBot, a specialized assistant.' })
    expect(result).not.toContain('You are CustomBot')
    expect(result).toContain('## Memories')
  })

  it('treats an empty system.md as an explicit custom base while retaining Cherry context', async () => {
    setupFiles({ [posix('/workspace/system.md')]: '' })

    const { base, context } = await builder.buildPromptParts(posix('/workspace'))

    expect(base).toEqual({ kind: 'custom', content: '' })
    expect(context).toContain('## Memories')
  })

  it('fails prompt construction when an explicit system.md cannot be opened', async () => {
    setupFiles({ [posix('/workspace/system.md')]: 'Custom base' })
    mockedOpen.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

    await expect(builder.buildPromptParts(posix('/workspace'))).rejects.toThrow(
      posix('Failed to read required agent prompt file: /workspace/system.md')
    )
  })

  it('fails prompt construction when an explicit system.md cannot be read', async () => {
    setupFiles({ [posix('/workspace/system.md')]: 'Custom base' })
    mockedOpen.mockResolvedValueOnce({
      stat: async () => ({ mtimeMs: 1000, isFile: () => true }),
      readFile: async () => {
        throw Object.assign(new Error('EIO'), { code: 'EIO' })
      },
      close: async () => undefined
    } as any)

    await expect(builder.buildPromptParts(posix('/workspace'))).rejects.toThrow(
      posix('Failed to read required agent prompt file: /workspace/system.md')
    )
  })

  it('includes soul.md in memories section', async () => {
    setupFiles({
      [posix('/workspace/soul.md')]: 'Warm but direct. Lead with answers.'
    })

    const { context } = await builder.buildPromptParts(posix('/workspace'))
    const result = context + '\n' + (await builder.buildMemoriesSection(posix('/workspace')))

    expect(result).toContain('## Memories')
    expect(result).toContain('<soul>')
    expect(result).toContain('Warm but direct. Lead with answers.')
    expect(result).toContain('</soul>')
  })

  it('preserves legacy SOUL.md content verbatim', async () => {
    const legacySoul = `# Role
Legacy research assistant

## Goals
Complete every research task thoroughly.

## Principles
Always cite primary sources.`
    setupFiles({ [posix('/workspace/SOUL.md')]: legacySoul })

    const context = await builder.buildMemoriesSection(posix('/workspace'))

    expect(context).toContain(`<soul>\n${legacySoul}\n</soul>`)
  })

  it('includes user.md in memories section', async () => {
    setupFiles({
      [posix('/workspace/user.md')]: 'Name: V\nTimezone: UTC+8'
    })

    const { context } = await builder.buildPromptParts(posix('/workspace'))
    const result = context + '\n' + (await builder.buildMemoriesSection(posix('/workspace')))

    expect(result).toContain('<user>')
    expect(result).toContain('Name: V')
    expect(result).toContain('</user>')
  })

  it('includes memory/FACT.md in memories section', async () => {
    setupFiles({
      [posix('/workspace/memory/FACT.md')]: '# Active Projects\n\n- Cherry Studio'
    })

    const { context } = await builder.buildPromptParts(posix('/workspace'))
    const result = context + '\n' + (await builder.buildMemoriesSection(posix('/workspace')))

    expect(result).toContain('<facts>')
    expect(result).toContain('Cherry Studio')
    expect(result).toContain('</facts>')
  })

  it('builds the memories section without the base agent prompt', async () => {
    setupFiles({
      [posix('/workspace/SOUL.md')]: 'Be concise.',
      [posix('/workspace/USER.md')]: 'Name: V',
      [posix('/workspace/memory/FACT.md')]: 'Project: Cherry Studio'
    })

    const result = await builder.buildMemoriesSection(posix('/workspace'))

    expect(result).toContain('<agent_identity>')
    expect(result).toContain('Be concise.')
    expect(result).toContain('Name: V')
    expect(result).toContain('Project: Cherry Studio')
    expect(result).not.toContain('## Autonomy Tools')
  })

  it('keeps system.md as the base while building memories as Cherry context', async () => {
    setupFiles({
      [posix('/workspace/system.md')]: 'You are CustomBot.',
      [posix('/workspace/soul.md')]: 'Sharp and efficient.'
    })

    const { base, context } = await builder.buildPromptParts(posix('/workspace'))
    const result = context + '\n' + (await builder.buildMemoriesSection(posix('/workspace')))

    expect(base).toEqual({ kind: 'custom', content: 'You are CustomBot.' })
    expect(result).not.toContain('You are CustomBot.')
    expect(result).toContain('<soul>')
    expect(result).toContain('Sharp and efficient.')
  })

  it('loads workspace system.md but identity and memory from the agent data directory', async () => {
    setupFiles({
      [posix('/workspace/system.md')]: 'Workspace-local system prompt.',
      [posix('/agent-data/SOUL.md')]: 'Persistent agent identity.',
      [posix('/agent-data/memory/FACT.md')]: 'Persistent agent fact.'
    })

    const { base, context } = await builder.buildPromptParts(
      posix('/workspace'),
      undefined,
      false,
      posix('/agent-data')
    )

    const result = context + '\n' + (await builder.buildMemoriesSection(posix('/agent-data')))

    expect(base).toEqual({ kind: 'custom', content: 'Workspace-local system prompt.' })
    expect(result).not.toContain('Workspace-local system prompt.')
    expect(result).toContain('Persistent agent identity.')
    expect(result).toContain('Persistent agent fact.')
    expect(result).toContain(posix('`/agent-data/`'))
    expect(result).toContain(posix('`/agent-data/SOUL.md`'))
  })

  it('always identifies the agent data directory when identity files are empty and bootstrap is skipped', async () => {
    setupFiles({})

    const { context: result } = await builder.buildPromptParts(
      posix('/workspace'),
      { ...baseConfig, bootstrap_completed: true },
      true,
      posix('/agent-data')
    )

    expect(result).not.toContain('## Bootstrap Mode')
    expect(result).toContain('## Memories')
    expect(result).toContain(posix('`/agent-data/SOUL.md`'))
    expect(result).toContain(posix('`/agent-data/USER.md`'))
    expect(result).toContain(posix('`/agent-data/memory/FACT.md`'))
  })

  it('ignores symbolic-link persona files', async () => {
    setupFiles({ [posix('/workspace/SOUL.md')]: 'must not be read' })
    mockedLstat.mockImplementation(async (filePath) => {
      const p = typeof filePath === 'string' ? filePath : filePath.toString()
      if (p === posix('/workspace/SOUL.md')) {
        return {
          mtimeMs: 1000,
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => true
        } as any
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const { context } = await builder.buildPromptParts(posix('/workspace'))
    const result = context + '\n' + (await builder.buildMemoriesSection(posix('/workspace')))

    expect(result).not.toContain('must not be read')
  })

  it('resolves filenames case-insensitively', async () => {
    // Files exist with different casing than the canonical names
    setupFiles({
      [posix('/workspace/SOUL.md')]: 'Uppercase soul',
      [posix('/workspace/User.md')]: 'Mixed case user',
      [posix('/workspace/memory/fact.md')]: 'Lowercase facts'
    })

    const { context } = await builder.buildPromptParts(posix('/workspace'))
    const result = context + '\n' + (await builder.buildMemoriesSection(posix('/workspace')))

    expect(result).toContain('<soul>')
    expect(result).toContain('Uppercase soul')
    expect(result).toContain('<user>')
    expect(result).toContain('Mixed case user')
    expect(result).toContain('<facts>')
    expect(result).toContain('Lowercase facts')
  })

  it('retains identity content on repeated reads', async () => {
    setupFiles({ [posix('/workspace/soul.md')]: 'Cached soul' })

    expect(await builder.buildMemoriesSection(posix('/workspace'))).toContain('Cached soul')
    expect(await builder.buildMemoriesSection(posix('/workspace'))).toContain('Cached soul')
  })

  describe('bootstrap mode', () => {
    it('injects bootstrap instructions when no config is provided and SOUL.md is empty', async () => {
      setupFiles({})

      const { context: result } = await builder.buildPromptParts(posix('/workspace'))

      expect(result).toContain('## Bootstrap Mode')
    })

    it('injects bootstrap instructions when bootstrap_completed is false', async () => {
      setupFiles({})

      const { context: result } = await builder.buildPromptParts(posix('/workspace'), {
        ...baseConfig,
        bootstrap_completed: false
      })

      expect(result).toContain('## Bootstrap Mode')
    })

    it('runs bootstrap when reset (bootstrap_completed false) even if the agent has instructions', async () => {
      setupFiles({
        [posix('/workspace/SOUL.md')]:
          'I am a warm, direct assistant who gives concise answers and adapts to the user’s communication style.'
      })

      const { context: result } = await builder.buildPromptParts(
        posix('/workspace'),
        { ...baseConfig, bootstrap_completed: false },
        true
      )

      expect(result).toContain('## Bootstrap Mode')
    })

    it('skips bootstrap when bootstrap_completed is true', async () => {
      setupFiles({})

      const { context: result } = await builder.buildPromptParts(posix('/workspace'), {
        ...baseConfig,
        bootstrap_completed: true
      })

      expect(result).not.toContain('## Bootstrap Mode')
    })

    it('onboards a configured role when its persona has not been established', async () => {
      setupFiles({})

      const { context: result } = await builder.buildPromptParts(posix('/workspace'), baseConfig, true)

      expect(result).toContain('## Bootstrap Mode')
    })

    it('skips bootstrap when SOUL.md has substantial content (legacy migration)', async () => {
      const realContent =
        'I am a warm, direct assistant. I lead with answers and prefer concise communication. I respect boundaries and always ask before making assumptions.'
      setupFiles({
        [posix('/workspace/SOUL.md')]: `# Soul\n\n> Template header\n\n${realContent}`
      })

      const { context: result } = await builder.buildPromptParts(posix('/workspace'))

      expect(result).not.toContain('## Bootstrap Mode')
    })

    it('still shows bootstrap when SOUL.md only has template headings', async () => {
      setupFiles({
        [posix('/workspace/SOUL.md')]:
          '# Soul\n\n> This file defines who you are. Update it as your personality evolves.\n\n## Personality\n\n\n## Tone\n\n'
      })

      const { context: result } = await builder.buildPromptParts(posix('/workspace'))

      expect(result).toContain('## Bootstrap Mode')
    })

    it('includes memories section alongside bootstrap instructions', async () => {
      setupFiles({
        [posix('/workspace/SOUL.md')]: '# Soul\n\n> This file defines who you are.\n\n## Personality\n\n\n## Tone\n\n',
        [posix('/workspace/user.md')]: 'Name: V'
      })

      const { context: result } = await builder.buildPromptParts(posix('/workspace'))

      expect(result).toContain('## Bootstrap Mode')
      expect(result).toContain('## Memories')
      expect(await builder.buildMemoriesSection(posix('/workspace'))).toContain('<user>')
    })
  })

  describe('buildFactsSection', () => {
    it('returns undefined when no FACT.md exists', async () => {
      setupFiles({})

      const result = await builder.buildFactsSection(posix('/workspace'))

      expect(result).toBeUndefined()
    })

    it('wraps memory/FACT.md content in an Agent Knowledge block', async () => {
      setupFiles({
        [posix('/workspace/memory/FACT.md')]: '- Project: cherry-studio\n- Build tool: pnpm + electron-vite'
      })

      const result = await builder.buildFactsSection(posix('/workspace'))

      expect(result).toBeDefined()
      expect(result).toContain('## Agent Knowledge')
      expect(result).toContain('<facts>')
      expect(result).toContain('Project: cherry-studio')
      expect(result).toContain('Build tool: pnpm + electron-vite')
      expect(result).toContain('</facts>')
    })

    it('resolves FACT.md case-insensitively', async () => {
      setupFiles({
        [posix('/workspace/memory/fact.md')]: '- lowercase filename'
      })

      const result = await builder.buildFactsSection(posix('/workspace'))

      expect(result).toBeDefined()
      expect(result).toContain('lowercase filename')
    })

    it('returns undefined when FACT.md exists but is empty', async () => {
      setupFiles({
        [posix('/workspace/memory/FACT.md')]: ''
      })

      const result = await builder.buildFactsSection(posix('/workspace'))

      expect(result).toBeUndefined()
    })

    it('does not include SOUL.md or USER.md content (those are persona files)', async () => {
      setupFiles({
        [posix('/workspace/SOUL.md')]: 'Warm but direct.',
        [posix('/workspace/user.md')]: 'Name: V',
        [posix('/workspace/memory/FACT.md')]: 'Build tool: pnpm'
      })

      const result = await builder.buildFactsSection(posix('/workspace'))

      expect(result).toBeDefined()
      expect(result).toContain('Build tool: pnpm')
      expect(result).not.toContain('Warm but direct')
      expect(result).not.toContain('Name: V')
      expect(result).not.toContain('<soul>')
      expect(result).not.toContain('<user>')
    })
  })
})
