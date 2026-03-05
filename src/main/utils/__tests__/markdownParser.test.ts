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
})
