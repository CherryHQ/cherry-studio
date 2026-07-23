import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import matter from 'gray-matter'
import { describe, expect, it } from 'vitest'

import { generateBundledPluginsManifest, serializeBundledPluginsManifest } from '../generators/plugins'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..')
const AGENT_DIR = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant')

describe('generateBundledPluginsManifest', () => {
  it('derives every enabled bundled skill from its current files', () => {
    const template = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'agent.template.json'), 'utf-8')) as {
      skills: string[]
    }
    const manifest = generateBundledPluginsManifest()

    expect(manifest.plugins.map(({ filename }) => filename)).toEqual(template.skills)

    for (const plugin of manifest.plugins) {
      const skillFile = path.join(AGENT_DIR, '.claude/skills', plugin.filename, 'SKILL.md')
      const content = fs.readFileSync(skillFile, 'utf-8')
      const frontmatter = matter(content).data as Record<string, unknown>

      expect(plugin.metadata.name).toBe(frontmatter.name)
      expect(plugin.metadata.description).toBe(frontmatter.description)
      expect(plugin.metadata.contentHash).toBe(createHash('sha256').update(content).digest('hex'))
      expect(plugin.metadata.size).toBeGreaterThanOrEqual(Buffer.byteLength(content))
    }
  })

  it('serializes the plugin manifest as stable JSON', () => {
    const manifest = generateBundledPluginsManifest()
    const serialized = serializeBundledPluginsManifest(manifest)

    expect(serialized.endsWith('\n')).toBe(true)
    expect(JSON.parse(serialized)).toEqual(manifest)
  })

  it('keeps large data attachments on the local-script path', () => {
    const skill = fs.readFileSync(path.join(AGENT_DIR, '.claude/skills/cherry-data-analyst/SKILL.md'), 'utf-8')

    expect(skill).toContain('mcp__cherry-tools__save_attachment')
    expect(skill).toContain('uv run python')
    expect(skill).toContain('不要循环调用 `read_file`')
    expect(skill).toContain('控制在 4KB 内')
  })
})
