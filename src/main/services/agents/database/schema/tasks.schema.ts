/**
 * Compatibility re-export for the shared agent task schema.
 *
 * The canonical table definition now lives under src/main/data/db/schemas.
 * TODO: Remove this file in a follow-up PR; import from @data/db/schemas/agentTask directly.
 */

export {
  type InsertAgentTaskRow as InsertTaskRow,
  type InsertAgentTaskRunLogRow as InsertTaskRunLogRow,
  agentTaskTable as scheduledTasksTable,
  type AgentTaskRow as TaskRow,
  type AgentTaskRunLogRow as TaskRunLogRow,
  agentTaskRunLogTable as taskRunLogsTable
} from '../../../../data/db/schemas/agentTask'
