/**
 * Compatibility re-export for the shared agents schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 */

export {
  type AgentsAgentRow as AgentRow,
  agentsAgentsTable as agentsTable,
  type InsertAgentsAgentRow as InsertAgentRow
} from '../../../../data/db/schemas/agentsAgents'
