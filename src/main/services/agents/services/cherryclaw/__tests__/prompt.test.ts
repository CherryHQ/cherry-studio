import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn()
}))

import { readdir, readFile, stat } from 'node:fs/promises'

import type { CherryClawConfiguration } from '@types'

import { PromptBuilder } from '../prompt'

const baseConfig: CherryClawConfiguration = {
  permission_mode: 'bypassPermissions',
  max_turns: 100,
  env_vars: {},
  soul_enabled: true
}

const mockedStat = vi.mocked(stat)
const mockedReadFile = vi.mocked(readFile)
const mockedReaddir = vi.mocked(readdir)

function setupFiles(files: Record<string, string>) {
  // Build directory listing from file paths
  const dirs = new Map<string, string[]>()
  for (const filePath of Object.keys(files)) {
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    const name = filePath.substring(filePath.lastIndexOf('/') + 1)
    if (!dirs.has(dir)) dirs.set(dir, [])
    dirs.get(dir)!.push(name)
  }

  mockedStat.mockImplementation(async (filePath) => {
    const p = typeof filePath === 'string' ? filePath : filePath.toString()
    if (files[p] !== undefined) {
      return { mtimeMs: 1000 } as any
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  mockedReadFile.mockImplementation(async (filePath) => {
    const p = typeof filePath === 'string' ? filePath : filePath.toString()
    if (files[p] !== undefined) {
      return files[p]
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  mockedReaddir.mockImplementation(async (dirPath) => {
    const p = typeof dirPath === 'string' ? dirPath : dirPath.toString()
    return (dirs.get(p) ?? []) as any
  })
}

describe('PromptBuilder', () => {
  let builder: PromptBuilder

  beforeEach(() => {
    builder = new PromptBuilder()
    vi.clearAllMocks()
  })

  it('returns default basic prompt when no workspace files exist', async () => {
    setupFiles({})

    const result = await builder.buildSystemPrompt('/workspace')

    expect(result).toContain('You are CherryClaw')
    expect(result).toContain('## CherryClaw Tools')
    expect(result).not.toContain('## Memories')
  })

  it('overrides basic prompt with system.md from workspace', async () => {
    setupFiles({
      '/workspace/system.md': 'You are CustomBot, a specialized assistant.'
    })

    const result = await builder.buildSystemPrompt('/workspace')

    expect(result).toContain('You are CustomBot')
    expect(result).not.toContain('You are CherryClaw')
  })

  it('includes soul.md in memories section', async () => {
    setupFiles({
      '/workspace/soul.md': 'Warm but direct. Lead with answers.'
    })

    const result = await builder.buildSystemPrompt('/workspace')

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

    const result = await builder.buildSystemPrompt('/workspace')

    expect(result).toContain('<user>')
    expect(result).toContain('Name: V')
    expect(result).toContain('</user>')
    expect(result).toContain('WHO the user is')
  })

  it('includes memory/FACT.md in memories section', async () => {
    setupFiles({
      '/workspace/memory/FACT.md': '# Active Projects\n\n- Cherry Studio'
    })

    const result = await builder.buildSystemPrompt('/workspace')

    expect(result).toContain('<facts>')
    expect(result).toContain('Cherry Studio')
    expect(result).toContain('</facts>')
    expect(result).toContain('WHAT you know')
  })

  it('includes all memory files when all exist', async () => {
    setupFiles({
      '/workspace/soul.md': 'Be concise.',
      '/workspace/user.md': 'Name: V',
      '/workspace/memory/FACT.md': 'Project: CherryClaw'
    })

    const result = await builder.buildSystemPrompt('/workspace')

    expect(result).toContain('<soul>')
    expect(result).toContain('<user>')
    expect(result).toContain('<facts>')
    expect(result).toContain('Update them autonomously')
    expect(result).toContain('exclusive scope')
  })

  it('combines system.md override with memories', async () => {
    setupFiles({
      '/workspace/system.md': 'You are CustomBot.',
      '/workspace/soul.md': 'Sharp and efficient.'
    })

    const result = await builder.buildSystemPrompt('/workspace')

    expect(result).toContain('You are CustomBot.')
    expect(result).toContain('<soul>')
    expect(result).toContain('Sharp and efficient.')
  })

  it('resolves filenames case-insensitively', async () => {
    // Files exist with different casing than the canonical names
    setupFiles({
      '/workspace/SOUL.md': 'Uppercase soul',
      '/workspace/User.md': 'Mixed case user',
      '/workspace/memory/fact.md': 'Lowercase facts'
    })

    const result = await builder.buildSystemPrompt('/workspace')

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

    await builder.buildSystemPrompt('/workspace')
    await builder.buildSystemPrompt('/workspace')

    // readFile should only be called once per unique file due to caching
    const soulReadCalls = mockedReadFile.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('soul.md')
    )
    expect(soulReadCalls).toHaveLength(1)
  })

  describe('bootstrap mode', () => {
    it('injects bootstrap instructions when no config is provided and SOUL.md is empty', async () => {
      setupFiles({})

      const result = await builder.buildSystemPrompt('/workspace')

      expect(result).toContain('## Bootstrap Mode')
      expect(result).toContain('complete_bootstrap')
    })

    it('injects bootstrap instructions when bootstrap_completed is false', async () => {
      setupFiles({})

      const result = await builder.buildSystemPrompt('/workspace', { ...baseConfig, bootstrap_completed: false })

      expect(result).toContain('## Bootstrap Mode')
    })

    it('skips bootstrap when bootstrap_completed is true', async () => {
      setupFiles({})

      const result = await builder.buildSystemPrompt('/workspace', { ...baseConfig, bootstrap_completed: true })

      expect(result).not.toContain('## Bootstrap Mode')
    })

    it('skips bootstrap when SOUL.md has substantial content (legacy migration)', async () => {
      const realContent =
        'I am a warm, direct assistant. I lead with answers and prefer concise communication. I respect boundaries and always ask before making assumptions.'
      setupFiles({
        '/workspace/SOUL.md': `# Soul\n\n> Template header\n\n${realContent}`
      })

      const result = await builder.buildSystemPrompt('/workspace')

      expect(result).not.toContain('## Bootstrap Mode')
    })

    it('still shows bootstrap when SOUL.md only has template headings', async () => {
      setupFiles({
        '/workspace/SOUL.md':
          '# Soul\n\n> This file defines who you are. Update it as your personality evolves.\n\n## Personality\n\n\n## Tone\n\n'
      })

      const result = await builder.buildSystemPrompt('/workspace')

      expect(result).toContain('## Bootstrap Mode')
    })

    it('includes memories section alongside bootstrap instructions', async () => {
      setupFiles({
        '/workspace/SOUL.md': '# Soul\n\n> This file defines who you are.\n\n## Personality\n\n\n## Tone\n\n',
        '/workspace/user.md': 'Name: V'
      })

      const result = await builder.buildSystemPrompt('/workspace')

      expect(result).toContain('## Bootstrap Mode')
      expect(result).toContain('## Memories')
      expect(result).toContain('<user>')
    })
  })
})
