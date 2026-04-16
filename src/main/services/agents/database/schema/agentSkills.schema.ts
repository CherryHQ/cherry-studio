/**
 * Compatibility re-export for the shared agents agent-skills schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agentsAgentSkills directly.
 */

export {
  type AgentsAgentSkillRow as AgentSkillRow,
  agentsAgentSkillsTable as agentSkillsTable,
  type InsertAgentsAgentSkillRow as InsertAgentSkillRow
} from '../../../../data/db/schemas/agentsAgentSkills'
