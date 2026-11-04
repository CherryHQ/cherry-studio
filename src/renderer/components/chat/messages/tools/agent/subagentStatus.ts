import type { CherryMessagePart } from '@shared/data/types/message'

import type { ToolStatus } from '../shared/GenericTools'

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
  switch (latest) {
    case 'pending':
    case 'in_progress':
      return status === 'cancelled' ? 'cancelled' : 'invoking'
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
