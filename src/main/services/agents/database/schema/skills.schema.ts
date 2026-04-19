/**
 * Compatibility re-export for the shared agent global-skill schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agentGlobalSkill directly.
 */

export {
  type InsertAgentGlobalSkillRow as InsertSkillRow,
  type AgentGlobalSkillRow as SkillRow,
  agentGlobalSkillTable as skillsTable
} from '../../../../data/db/schemas/agentGlobalSkill'
