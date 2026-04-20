/**
 * Compatibility re-export for the shared agent session schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agentSession directly.
 */

export {
  type InsertAgentSessionRow as InsertSessionRow,
  type AgentSessionRow as SessionRow,
  agentSessionTable as sessionsTable
} from '../../../../data/db/schemas/agentSession'
