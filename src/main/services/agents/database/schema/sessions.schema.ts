/**
 * Compatibility re-export for the shared agents sessions schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agentsSessions directly.
 */

export {
  type InsertAgentsSessionRow as InsertSessionRow,
  type AgentsSessionRow as SessionRow,
  agentsSessionsTable as sessionsTable
} from '../../../../data/db/schemas/agentsSessions'
