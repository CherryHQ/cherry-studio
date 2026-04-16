/**
 * Compatibility re-export for the shared agents global-skills schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agentsSkills directly.
 */

export {
  type InsertAgentsGlobalSkillRow as InsertSkillRow,
  type AgentsGlobalSkillRow as SkillRow,
  agentsGlobalSkillsTable as skillsTable
} from '../../../../data/db/schemas/agentsSkills'
