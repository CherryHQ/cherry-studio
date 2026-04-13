/**
 * Compatibility re-export for the shared agents session messages schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 */

export {
  type InsertAgentsSessionMessageRow as InsertSessionMessageRow,
  type AgentsSessionMessageRow as SessionMessageRow,
  agentsSessionMessagesTable as sessionMessagesTable
} from '../../../../data/db/schemas/agentsSessionMessages'
