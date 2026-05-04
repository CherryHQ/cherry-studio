/**
 * Dedup + merge across skill sources.
 *
 * Two dedup keys, applied in order:
 *
 * 1. **realpath** — same physical file surfaced through multiple
 *    sources (the typical case is the SkillInstaller symlink farm:
 *    `<workspace>/.claude/skills/X` is a symlink to `<dataPath>/Skills/X`).
 *    First occurrence wins; later sources skip the duplicate without
 *    further evaluation.
 *
 * 2. **name** — different physical files but same `name` frontmatter,
 *    typically because the user has the same skill in multiple
 *    locations. Priority HIGH wins. Implemented via iteration order:
 *    callers must pass source lists ordered LOW → HIGH so a later
 *    `byName.set(name, skill)` overwrites the earlier entry.
 *
 * Output is sorted by name alphabetically — the catalog system
 * prompt section renders in this order, and stable ordering is
 * required for prompt cache stability.
 */

import { realpathSync } from 'node:fs'

import type { Skill } from './types'

export function mergeSkills(sourceLists: Skill[][]): Skill[] {
  const byName = new Map<string, Skill>()
  const seenRealPaths = new Set<string>()

  for (const list of sourceLists) {
    for (const skill of list) {
      const real = canonicalize(skill.path)
      if (real && seenRealPaths.has(real)) continue
      if (real) seenRealPaths.add(real)
      byName.set(skill.name, real ? { ...skill, path: real } : skill)
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function canonicalize(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}
