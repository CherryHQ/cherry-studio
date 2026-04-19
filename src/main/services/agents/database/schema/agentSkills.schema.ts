/**
 * Compatibility re-export for the shared per-agent skill junction schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agentSkill directly.
 */

export {
  type AgentSkillRow,
  agentSkillTable as agentSkillsTable,
  type InsertAgentSkillRow
} from '../../../../data/db/schemas/agentSkill'
