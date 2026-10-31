import * as fs from 'fs'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parsePluginMetadata, parseSkillMetadata } from '../markdownParser'

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    stat: vi.fn()
  }
}))

vi.mock('../fileOperations', () => ({
  getDirectorySize: vi.fn().mockResolvedValue(123)
}))

describe('markdownParser', () => {
  const pluginContent = `---
name: bad-plugin
description: Use this agent when example: user: "hi"
tools: ["Read", "Grep"]
---

Body`

  const skillContent = `---
name: bad-skill
description: Use this skill when example: user: "hi"
tools: Read, Grep
---

Body`

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: 42 } as fs.Stats)
    vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
      if (String(filePath).includes('SKILL.md')) {
        return skillContent
      }
      return pluginContent
    })
  })

  it('throws an Error with metadata when the skill folder path is invalid', async () => {
    const promise = parseSkillMetadata('relative/skill', 'skills/bad-skill', 'skills')

    await expect(promise).rejects.toBeInstanceOf(Error)
    await expect(promise).rejects.toMatchObject({
      name: 'PluginError',
      type: 'INVALID_METADATA',
      path: 'relative/skill',
      message: 'Skill folder path must be absolute'
    })
  })

  it('throws an Error with metadata when the skill markdown file is missing', async () => {
    vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'))
    const promise = parseSkillMetadata('/abs/missing-skill', 'skills/missing-skill', 'skills')

    await expect(promise).rejects.toBeInstanceOf(Error)
    await expect(promise).rejects.toMatchObject({
      name: 'PluginError',
      type: 'FILE_NOT_FOUND',
      path: '/abs/missing-skill/SKILL.md',
      message: 'SKILL.md or skill.md not found in skill folder'
    })
  })

  it('throws an Error with metadata when the skill markdown file cannot be read', async () => {
    vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('EACCES'))
    const promise = parseSkillMetadata('/abs/unreadable-skill', 'skills/unreadable-skill', 'skills')

    await expect(promise).rejects.toBeInstanceOf(Error)
    await expect(promise).rejects.toMatchObject({
      name: 'PluginError',
      type: 'READ_FAILED',
      path: '/abs/unreadable-skill/SKILL.md',
      message: 'EACCES'
    })
  })

  it('recovers invalid plugin frontmatter and keeps metadata', async () => {
    const metadata = await parsePluginMetadata('/abs/plugin.md', 'plugins/plugin.md', 'plugins', 'agent')
    // Malformed YAML must still report strict failure and recovery.
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Failed to parse plugin frontmatter, attempting recovery',
      expect.objectContaining({ filePath: '/abs/plugin.md' })
    )
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Recovered frontmatter using loose parser',
      expect.objectContaining({ filePath: '/abs/plugin.md' })
    )
    expect(metadata.name).toBe('bad-plugin')
    expect(metadata.description).toContain('example: user')
    expect(metadata.tools).toEqual(['Read', 'Grep'])
  })

  it('recovers invalid skill frontmatter and keeps metadata', async () => {
    const metadata = await parseSkillMetadata('/abs/skill', 'skills/bad-skill', 'skills')
    // Malformed YAML must still report strict failure and recovery.
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Failed to parse SKILL.md frontmatter, attempting recovery',
      expect.objectContaining({ skillMdPath: '/abs/skill/SKILL.md' })
    )
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Recovered frontmatter using loose parser',
      expect.objectContaining({ skillMdPath: '/abs/skill/SKILL.md' })
    )
    expect(metadata.name).toBe('bad-skill')
    expect(metadata.description).toContain('example: user')
    expect(metadata.tools).toEqual(['Read', 'Grep'])
  })

  it('reads skill runtime fields and nested metadata version', async () => {
    vi.mocked(fs.promises.readFile).mockResolvedValue(`---
name: parallel-web-search
slug: parallel-web-search
context: fork
agent: parallel:parallel-subagent
allowed-tools: Bash(parallel-cli:*)
metadata:
  version: "1.0.12"
---

Body`)

    const metadata = await parseSkillMetadata('/abs/skill', 'skills/git', 'skills')

    expect(metadata.slug).toBe('parallel-web-search')
    expect(metadata.version).toBe('1.0.12')
    expect(metadata).toMatchObject({
      context: 'fork',
      agent: 'parallel:parallel-subagent',
      allowed_tools: ['Bash(parallel-cli:*)']
    })
  })

  it('prefers a top-level skill version over metadata.version', async () => {
    vi.mocked(fs.promises.readFile).mockResolvedValue(`---
name: versioned-skill
version: "2.0.0"
metadata:
  version: "1.0.0"
---

Body`)

    const metadata = await parseSkillMetadata('/abs/skill', 'skills/versioned-skill', 'skills')

    expect(metadata.version).toBe('2.0.0')
  })

  describe.each([
    {
      api: 'skill',
      read: () => parseSkillMetadata('/abs/skill', 'skills/a', 'skills'),
      malformed: skillContent,
      failure: 'Failed to parse SKILL.md frontmatter, attempting recovery',
      logContext: { skillMdPath: '/abs/skill/SKILL.md' },
      recoveredName: 'bad-skill'
    },
    {
      api: 'plugin',
      read: () => parsePluginMetadata('/abs/plugin.md', 'plugins/plugin.md', 'plugins', 'agent'),
      malformed: pluginContent,
      failure: 'Failed to parse plugin frontmatter, attempting recovery',
      logContext: { filePath: '/abs/plugin.md' },
      recoveredName: 'bad-plugin'
    }
  ])('$api line endings', ({ api, read, malformed, failure, logContext, recoveredName }) => {
    function expectNoRecovery() {
      for (const message of [
        'Failed to parse SKILL.md frontmatter, attempting recovery',
        'Failed to parse plugin frontmatter, attempting recovery',
        'Recovered frontmatter using loose parser'
      ]) {
        expect(mockMainLoggerService.warn).not.toHaveBeenCalledWith(message, expect.any(Object))
      }
    }

    describe.each([
      { encoding: 'CRLF', eol: '\r\n' },
      { encoding: 'LF', eol: '\n' }
    ])('$encoding', ({ eol }) => {
      it.each([
        // A final quoted nested version must not force recovery and lose the skill version.
        {
          caseName: 'nested quoted version',
          tail: 'metadata:\n  version: "1.1"',
          version: api === 'skill' ? '1.1' : undefined
        },
        // A final quoted description can look correct after recovery; require strict success.
        { caseName: 'quoted description', tail: 'description: "quoted desc"', description: 'quoted desc' },
        // An ignored flow mapping must not silently send supported fields through recovery.
        { caseName: 'flow mapping', tail: 'openclaw: {"k": "v"}' },
        // A final flow sequence must preserve its elements without recovery.
        { caseName: 'flow sequence', tail: 'tags: [Read, Grep]', tags: ['Read', 'Grep'] },
        // Plain plugin descriptions must not retain gray-matter's terminal CR.
        { caseName: 'plain description', tail: 'description: plain desc', description: 'plain desc' },
        // Failsafe top-level versions must remain clean strings, not strings ending in CR.
        { caseName: 'plain top-level version', tail: 'version: 1.1', version: '1.1' },
        // A terminal CR must not contaminate nested skill versions either.
        ...(api === 'skill'
          ? [{ caseName: 'plain nested version', tail: 'metadata:\n  version: 1.1', version: '1.1' }]
          : [])
      ])('parses $caseName strictly with exact fields', async ({ tail, ...fixture }) => {
        const lines = [
          '---',
          'name: a',
          'author: author',
          'slug: a-slug',
          'context: fork',
          'agent: example-agent',
          'allowed-tools: Read, Grep',
          'tools: [Read, Grep]',
          ...(fixture.description === undefined ? ['description: base desc'] : []),
          ...tail.split('\n'),
          '---',
          '',
          'Body'
        ]
        vi.mocked(fs.promises.readFile).mockResolvedValue(lines.join(eol))

        const metadata = await read()

        expect(metadata).toMatchObject({
          name: 'a',
          description: fixture.description ?? 'base desc',
          author: 'author',
          tools: ['Read', 'Grep'],
          allowed_tools: ['Read', 'Grep'],
          tags: fixture.tags,
          version: fixture.version
        })
        if (api === 'skill') {
          expect(metadata).toMatchObject({ slug: 'a-slug', context: 'fork', agent: 'example-agent' })
        }
        expectNoRecovery()
      })
    })

    it('parses mixed endings with a final quoted description strictly', async () => {
      // Mixed endings leave the same bare CR after gray-matter slices the closing delimiter.
      vi.mocked(fs.promises.readFile).mockResolvedValue('---\nname: a\r\ndescription: "quoted desc"\r\n---\r\nBody\r\n')
      const metadata = await read()
      expectNoRecovery()
      expect(metadata).toMatchObject({ name: 'a', description: 'quoted desc' })
    })

    it('hashes the original CRLF bytes', async () => {
      // Normalizing the whole document would change this independently pinned raw hash.
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        '---\r\nname: a\r\ndescription: "quoted desc"\r\n---\r\n\r\nBody text here.\r\n'
      )
      const metadata = await read()
      expect(metadata.contentHash).toBe('42c8100404652e2d60c7607fd5f50a8e785050860bda3a026742141111c261a3')
      expectNoRecovery()
    })

    it('preserves an explicitly escaped CR in an LF description', async () => {
      // Removing CR from decoded values would corrupt an intentional YAML escape.
      vi.mocked(fs.promises.readFile).mockResolvedValue('---\nname: a\ndescription: "a\\rb"\n---\nBody')
      const metadata = await read()
      expect(metadata.description).toBe('a\rb')
      expectNoRecovery()
    })

    it('recovers malformed CRLF frontmatter with both warnings and metadata', async () => {
      // Newline repair must not accept a genuinely malformed description as strict YAML.
      vi.mocked(fs.promises.readFile).mockResolvedValue(malformed.replace(/\n/g, '\r\n'))
      const metadata = await read()
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(failure, expect.objectContaining(logContext))
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'Recovered frontmatter using loose parser',
        expect.objectContaining(logContext)
      )
      expect(metadata.name).toBe(recoveredName)
      expect(metadata.description).toContain('example: user')
      expect(metadata.tools).toEqual(['Read', 'Grep'])
    })
  })
})
