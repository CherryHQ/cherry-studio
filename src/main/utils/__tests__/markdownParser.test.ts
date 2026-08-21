import * as fs from 'fs'
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
    expect(metadata.name).toBe('bad-plugin')
    expect(metadata.description).toContain('example: user')
    expect(metadata.tools).toEqual(['Read', 'Grep'])
  })

  it('recovers invalid skill frontmatter and keeps metadata', async () => {
    const metadata = await parseSkillMetadata('/abs/skill', 'skills/bad-skill', 'skills')
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
})
