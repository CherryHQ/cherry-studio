/**
 * Compatibility re-export for the shared agent schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agent directly.
 */

export {
  type AgentRow,
  agentTable as agentsTable,
  type InsertAgentRow
} from '../../../../data/db/schemas/agent'
