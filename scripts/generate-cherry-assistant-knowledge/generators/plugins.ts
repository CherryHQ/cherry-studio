import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import matter from 'gray-matter'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..')
const AGENT_DIR = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant')
const AGENT_TEMPLATE_FILE = path.join(AGENT_DIR, 'agent.template.json')
const SKILLS_DIR = path.join(AGENT_DIR, '.claude/skills')
const PLUGIN_MANIFEST_LAST_UPDATED = 1784791029000

interface AgentTemplate {
  skills: string[]
}

export interface BundledPluginsManifest {
  version: 1
  lastUpdated: number
  plugins: Array<{
    filename: string
    type: 'skill'
    metadata: {
      sourcePath: string
      filename: string
      name: string
      description: string
      category: 'skills'
      type: 'skill'
      size: number
      contentHash: string
    }
  }>
}

function readBundledSkillNames(): string[] {
  const template = JSON.parse(fs.readFileSync(AGENT_TEMPLATE_FILE, 'utf-8')) as AgentTemplate
  if (!Array.isArray(template.skills) || template.skills.some((skill) => typeof skill !== 'string')) {
    throw new Error('agent.template.json skills must be a string array')
  }
  if (new Set(template.skills).size !== template.skills.length) {
    throw new Error('agent.template.json skills must be unique')
  }
  return template.skills
}

function getDirectorySize(directory: string): number {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return total + getDirectorySize(entryPath)
    if (entry.isFile()) return total + fs.statSync(entryPath).size
    return total
  }, 0)
}

function readSkillPlugin(filename: string): BundledPluginsManifest['plugins'][number] {
  if (!/^[a-z0-9-]+$/.test(filename)) {
    throw new Error(`Invalid bundled skill directory name: ${filename}`)
  }

  const skillDirectory = path.join(SKILLS_DIR, filename)
  const skillFile = path.join(skillDirectory, 'SKILL.md')
  const content = fs.readFileSync(skillFile, 'utf-8')
  const metadata = matter(content).data as Record<string, unknown>
  if (metadata.name !== filename) {
    throw new Error(`Bundled skill ${filename} must declare the same frontmatter name`)
  }
  if (typeof metadata.description !== 'string' || metadata.description.trim().length === 0) {
    throw new Error(`Bundled skill ${filename} must declare a description`)
  }

  return {
    filename,
    type: 'skill',
    metadata: {
      sourcePath: `skills/${filename}`,
      filename,
      name: filename,
      description: metadata.description.trim(),
      category: 'skills',
      type: 'skill',
      size: getDirectorySize(skillDirectory),
      contentHash: createHash('sha256').update(content).digest('hex')
    }
  }
}

export function generateBundledPluginsManifest(): BundledPluginsManifest {
  return {
    version: 1,
    lastUpdated: PLUGIN_MANIFEST_LAST_UPDATED,
    plugins: readBundledSkillNames().map(readSkillPlugin)
  }
}

export function serializeBundledPluginsManifest(manifest = generateBundledPluginsManifest()): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
