import type { CherryMessagePart } from '@shared/data/types/message'

import type { AgentLaunchIndex } from '../shared/agentToolTypes'
import type { ToolStatus } from '../shared/GenericTools'

function mapTaskStatus(status: string | undefined, fallback?: ToolStatus): ToolStatus | undefined {
  switch (status) {
    case 'pending':
    case 'in_progress':
      return fallback === 'cancelled' ? 'cancelled' : 'invoking'
    case 'completed':
      return 'done'
    case 'stopped':
      return 'cancelled'
    case 'error':
      return 'error'
    default:
      return undefined
  }
}

/**
 * A row's task status through the list-level index: the row's resolved flow root answers for the
 * child's whole history and live edges, which a settled group's emptied parts context cannot.
 */
export function getSubagentTaskStatusFromIndex(
  launchIndex: AgentLaunchIndex | null | undefined,
  rootCallId: string | undefined,
  status?: ToolStatus
): ToolStatus | undefined {
  if (!rootCallId) return undefined
  const taskId = launchIndex?.taskIdByCallId.get(rootCallId)
  if (!taskId) return undefined
  return mapTaskStatus(launchIndex?.latestTaskEventByTaskId.get(taskId)?.status, status)
}

/** Parts-only lookup for hosts that mount no launch index (image capture, export). */
export function getSubagentTaskStatus(
  parts: CherryMessagePart[],
  toolCallId?: string,
  status?: ToolStatus
): ToolStatus | undefined {
  if (!toolCallId) return undefined
  const events = parts.filter((part) => part.type === 'data-agent-task-event')
  const taskId = events.find((part) => part.data.toolUseId === toolCallId)?.data.taskId
  if (!taskId) return undefined
  const latest = events.findLast((part) => part.data.taskId === taskId && part.data.status)?.data.status
  return mapTaskStatus(latest, status)
}
