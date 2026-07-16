/**
 * Managed `skill` tool for the `ai-sdk` agent runtime (plan D6).
 *
 * The input is a skill NAME from the agent's enabled catalog — never a path.
 * Enablement is re-resolved from `skillService` at fire-time so disabling a
 * skill mid-session takes effect on the next call, and the read goes through
 * `skillService.readFile`, which clamps to the skill's own storage root.
 */

import { skillService } from '@main/ai/skills/SkillService'
import type { Tool } from 'ai'
import * as z from 'zod'

export const SkillToolSchema = z.object({
  name: z.string().describe('The name of an enabled skill, exactly as listed in the Skills section')
})

export function createSkillTool(agentId: string): Tool {
  return {
    description: `Loads the full instructions of an enabled managed skill.

- Use when a task matches a skill advertised in the Skills section of your instructions
- Takes the skill name exactly as listed; file paths are not accepted
- Returns the skill's SKILL.md content — follow it for the current task`,
    inputSchema: SkillToolSchema,
    execute: async (input: unknown) => {
      const parsed = SkillToolSchema.safeParse(input)
      if (!parsed.success) throw new Error(`Invalid arguments for skill: ${parsed.error}`)

      const skills = await skillService.list({ agentId })
      const enabled = skills.filter((skill) => skill.isEnabled)
      const skill = enabled.find((candidate) => candidate.name === parsed.data.name)
      if (!skill) {
        const available = enabled.map((candidate) => candidate.name).join(', ') || 'none'
        throw new Error(`Skill "${parsed.data.name}" is not enabled for this agent. Available skills: ${available}`)
      }

      const content = await skillService.readFile(skill.id, 'SKILL.md')
      if (content === null) {
        throw new Error(`Skill "${skill.name}" has no readable SKILL.md`)
      }
      return content
    }
  }
}
