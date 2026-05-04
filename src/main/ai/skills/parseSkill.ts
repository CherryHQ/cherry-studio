/**
 * SKILL.md parser — wraps `gray-matter`, the project's frontmatter
 * parsing library. gray-matter handles CRLF, in-body `---`, and full
 * YAML semantics (quoted strings, list shapes, nested values) for
 * free; we just normalise its output to Cherry's `Skill` shape and
 * enforce the only required field (`name`).
 *
 * Returns `null` on missing-name or any parse failure — the caller
 * (filesystem source / dbSource) filters nulls so a single malformed
 * file doesn't abort a scan.
 */

import { createHash } from 'node:crypto'

import matter from 'gray-matter'

import type { Skill, SourceId } from './types'

interface ParseInput {
  raw: string
  path: string
  source: SourceId
}

interface SkillFrontmatter {
  name?: unknown
  description?: unknown
  'allowed-tools'?: unknown
  allowedTools?: unknown
}

export function parseSkill(input: ParseInput): Skill | null {
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(input.raw)
  } catch {
    return null
  }

  const fm = parsed.data as SkillFrontmatter
  const name = typeof fm.name === 'string' ? fm.name.trim() : ''
  if (!name) return null

  const description = typeof fm.description === 'string' ? fm.description.trim() : ''
  const allowedTools = normalizeAllowedTools(fm['allowed-tools'] ?? fm.allowedTools)

  const body = parsed.content.replace(/^\n+/, '')
  const contentHash = createHash('sha256').update(body).digest('hex')

  return {
    id: `${input.source}::${name}`,
    name,
    description,
    body,
    source: input.source,
    path: input.path,
    contentHash,
    ...(allowedTools && { allowedTools })
  }
}

function normalizeAllowedTools(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tools = value.filter((t): t is string => typeof t === 'string' && t.length > 0)
    return tools.length > 0 ? tools : undefined
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const tools = value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    return tools.length > 0 ? tools : undefined
  }
  return undefined
}
