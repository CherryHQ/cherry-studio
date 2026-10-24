import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import { parseDocument } from 'yaml'

import { MCP_SKILL_MAX_BYTES, type McpSkill } from '@shared/types/mcpSkills'

export function skillRoot(uri: string): string {
  if (!uri.endsWith('/SKILL.md')) throw new Error('Skill URI must end with /SKILL.md')
  return uri.slice(0, -'/SKILL.md'.length)
}

export function skillRelativePath(root: string, uri: string): string {
  if (!uri.startsWith(`${root}/`)) throw new Error('Resource is outside the skill root')
  const relative = uri.slice(root.length + 1)
  for (const segment of relative.split('/')) {
    const decoded = decodeURIComponent(segment)
    if (
      !decoded ||
      decoded === '.' ||
      decoded === '..' ||
      /[\\/?#]/.test(decoded) ||
      [...decoded].some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error('Invalid skill resource path')
  }
  return relative
}

export function validateMcpSkill(skill: McpSkill): McpSkill {
  const root = skillRoot(skill.uri)
  const parsed = new URL(root)
  if (
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password ||
    root.includes('\\') ||
    [...root].some((character) => character.charCodeAt(0) <= 32)
  )
    throw new Error('Invalid skill root URI')
  const schemeEnd = root.indexOf('://')
  if (schemeEnd < 1) throw new Error('Skill URI must be hierarchical')
  skillRelativePath(root.slice(0, schemeEnd + 2), root)
  if (decodeURIComponent(root.slice(root.lastIndexOf('/') + 1)) !== skill.frontmatter.name)
    throw new Error('Skill URI does not match its name')
  if (skill.resources === 'dynamic') return skill
  const seen = new Set<string>()
  let size = 0
  for (const resource of skill.resources) {
    const relative = decodeURIComponent(skillRelativePath(root, resource.uri))
    if (seen.has(relative)) throw new Error('Duplicate skill resource')
    seen.add(relative)
    size += resource.size
  }
  if (!skill.resources.some((resource) => resource.uri === skill.uri)) throw new Error('Manifest omits SKILL.md')
  if (size > MCP_SKILL_MAX_BYTES) throw new Error('Skill exceeds 16 MiB')
  return skill
}

export function verifyMcpSkillFile(skill: McpSkill, uri: string, bytes: Uint8Array): void {
  if (skill.resources === 'dynamic') throw new Error('Dynamic MCP skills cannot be verified')
  const entry = skill.resources.find((resource) => resource.uri === uri)
  if (!entry) throw new Error('File is not in the held skill manifest')
  if (bytes.byteLength !== entry.size || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== entry.digest)
    throw new Error('Skill file failed size or digest verification')
  if (uri !== skill.uri) return
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) throw new Error('Skill is missing YAML frontmatter')
  const document = parseDocument(match[1], { uniqueKeys: true })
  if (document.errors.length) throw new Error('Invalid skill frontmatter')
  const frontmatter: unknown = document.toJS({ maxAliasCount: 0 })
  if (!isDeepStrictEqual(frontmatter, skill.frontmatter)) throw new Error('Skill frontmatter does not match manifest')
}
