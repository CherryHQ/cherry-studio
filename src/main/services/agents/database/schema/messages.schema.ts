/**
 * Compatibility re-export for the shared agent session message schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agentSessionMessage directly.
 */

export {
  type InsertAgentSessionMessageRow as InsertSessionMessageRow,
  type AgentSessionMessageRow as SessionMessageRow,
  agentSessionMessageTable as sessionMessagesTable
} from '../../../../data/db/schemas/agentSessionMessage'
