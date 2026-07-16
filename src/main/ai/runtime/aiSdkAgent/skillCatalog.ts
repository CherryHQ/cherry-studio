/**
 * Managed-skill catalog prompt input for the AI SDK agent runtime.
 *
 * Trust policy: only Cherry-managed skills the user enabled for this agent
 * are surfaced (resolved through `skillService`'s store, never workspace or
 * user-global discovery), and only their metadata enters the system prompt —
 * skill bodies stay on demand behind the `skill` tool so the base prompt
 * doesn't ingest every SKILL.md eagerly.
 */

import { skillService } from '@main/ai/skills/SkillService'

export interface AgentSkillCatalogEntry {
  name: string
  description: string | null
  folderName: string
}

/** Metadata of the skills enabled for this agent, for prompt + `skill` tool use. */
export async function resolveEnabledSkillCatalog(agentId: string): Promise<AgentSkillCatalogEntry[]> {
  const skills = await skillService.list({ agentId })
  return skills
    .filter((skill) => skill.isEnabled)
    .map(({ name, description, folderName }) => ({ name, description, folderName }))
}

/**
 * Render the skill catalog section, or `undefined` when no skill is enabled.
 * The section references the `skill` tool, so callers must only include it
 * once that tool is registered on the request.
 */
export function buildSkillCatalogSection(entries: readonly AgentSkillCatalogEntry[]): string | undefined {
  if (entries.length === 0) return undefined
  const lines = entries.map((entry) => `- ${entry.name}${entry.description ? `: ${entry.description}` : ''}`)
  return [
    '# Skills',
    'The following managed skills are enabled for this agent. When a task matches a skill, read its full instructions with the `skill` tool before applying it.',
    lines.join('\n')
  ].join('\n\n')
}
