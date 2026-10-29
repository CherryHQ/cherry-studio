import type { CherryMessagePart } from '@shared/data/types/message'

import { type AgentLaunchIndex, type AgentTaskLiveness, TERMINAL_TASK_STATUSES } from '../shared/agentToolTypes'
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
 * child's whole history and live edges, which a settled group's emptied parts context cannot. A
 * nonterminal edge is only trusted while the task is live, as the status pane already requires.
 */
export function getSubagentTaskStatusFromIndex(
  launchIndex: AgentLaunchIndex | null | undefined,
  rootCallId: string | undefined,
  status?: ToolStatus,
  liveness?: AgentTaskLiveness
): ToolStatus | undefined {
  if (!rootCallId) return undefined
  const taskId = launchIndex?.taskIdByCallId.get(rootCallId)
  if (!taskId) return undefined
  const eventStatus = launchIndex?.latestTaskEventByTaskId.get(taskId)?.status
  if (eventStatus && !TERMINAL_TASK_STATUSES.has(eventStatus) && liveness) {
    const originMessageId = launchIndex?.taskOriginMessageIdByTaskId.get(taskId)
    const live =
      (originMessageId !== undefined && liveness.activeMessageIds.has(originMessageId)) ||
      liveness.liveBackgroundTaskIds.has(taskId)
    // An interrupted turn or a process exit leaves the last edge at in_progress forever, so an
    // unvouched nonterminal edge must not override the historical terminal outcome — a stale
    // progress edge over a stopped/error run must not read as the row's own done status.
    if (!live) return mapTaskStatus(launchIndex?.terminalTaskStatusByTaskId.get(taskId), status)
  }
  return mapTaskStatus(eventStatus, status)
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
