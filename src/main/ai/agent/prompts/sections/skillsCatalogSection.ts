import { listCatalog } from '@main/ai/skills/catalog'

import type { SectionContributor } from './types'

const DESCRIPTION_MAX = 200

/**
 * Catalog of available skills. XML wrapping mirrors `<deferred-tools>`
 * — Cherry's convention for structured inventories the model needs to
 * parse and address. Free-form rule prose elsewhere stays as markdown
 * headings; this section is data, not rules.
 *
 * Cacheable: the list is stable for the session; the underlying
 * loader invalidates by mtime when SKILL.md files change.
 */
export const skillsCatalogSection: SectionContributor = async (ctx) => {
  const skills = await listCatalog({ workspaceRoot: ctx.workspaceRoot ?? null })
  if (skills.length === 0) return undefined

  // Defense in depth: the catalog already sorts, but a regression in
  // the merger (or a future variant that returns insertion order)
  // would silently bust prompt-cache stability.
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name))

  const items = sorted.map((skill) => {
    const desc = truncate(skill.description, DESCRIPTION_MAX)
    const safeName = escapeAttr(skill.name)
    return desc ? `  <skill name="${safeName}">${escapeText(desc)}</skill>` : `  <skill name="${safeName}"/>`
  })

  const text = `<available-skills>
The model has access to the following user-installed skills. To follow a skill's full instructions, call \`skills__load\` with the exact skill name.

${items.join('\n')}
</available-skills>`

  return {
    id: 'skills_catalog',
    text,
    cacheable: true
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).trimEnd()}…`
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
