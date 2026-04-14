/**
 * Compatibility re-export for the shared agents tasks schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agentsTasks directly.
 */

export {
  type InsertAgentsTaskRow as InsertTaskRow,
  type InsertAgentsTaskRunLogRow as InsertTaskRunLogRow,
  agentsTasksTable as scheduledTasksTable,
  type AgentsTaskRow as TaskRow,
  type AgentsTaskRunLogRow as TaskRunLogRow,
  agentsTaskRunLogsTable as taskRunLogsTable
} from '../../../../data/db/schemas/agentsTasks'
