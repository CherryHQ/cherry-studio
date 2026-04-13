/**
 * Compatibility re-export for the shared agents skills schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 */

export {
  type InsertAgentsSkillRow as InsertSkillRow,
  type AgentsSkillRow as SkillRow,
  agentsSkillsTable as skillsTable
} from '../../../../data/db/schemas/agentsSkills'
