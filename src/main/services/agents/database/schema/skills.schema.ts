/**
 * Compatibility re-export for the shared agents skills schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agentsSkills directly.
 */

export {
  type InsertAgentsSkillRow as InsertSkillRow,
  type AgentsSkillRow as SkillRow,
  agentsSkillsTable as skillsTable
} from '../../../../data/db/schemas/agentsSkills'
