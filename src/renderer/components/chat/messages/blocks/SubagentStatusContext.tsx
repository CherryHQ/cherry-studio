import { createContext, type ReactNode, useMemo } from 'react'

import { useProjectedToolParts } from '@renderer/hooks/agent/useAgentToolParts'
import { messagePartsAt, type MessagePartRows, PartOverrides } from '@renderer/utils/message/messagePartRows'
import type { ProjectionTarget } from '@shared/ai/messageProjection'
import type { CherryMessagePart } from '@shared/data/types/message'

import type { ToolStatus } from '../tools/shared/GenericTools'

const isTaskEvent = (part: CherryMessagePart) => part.type === 'data-agent-task-event'
type TaskEvent = Extract<CherryMessagePart, { type: 'data-agent-task-event' }>
type TaskStatusLookup = (toolCallId?: string, toolStatus?: ToolStatus) => ToolStatus | undefined

export const SubagentStatusContext = createContext<TaskStatusLookup>(() => undefined)

function buildStatusLookup(
  rows: readonly (string | TaskEvent[])[],
  live?: ReadonlyMap<string, CherryMessagePart[]>
): TaskStatusLookup {
  const taskIds = new Map<string, string>()
  const statuses = new Map<string, NonNullable<TaskEvent['data']['status']>>()
  for (const row of rows) {
    const parts = typeof row === 'string' ? live?.get(row) : row
    if (!parts) continue
    for (const part of parts) {
      if (!isTaskEvent(part)) continue
      const { toolUseId, taskId, status } = part.data
      if (toolUseId && !taskIds.has(toolUseId)) taskIds.set(toolUseId, taskId)
      if (status) statuses.set(taskId, status)
    }
  }
  return (toolCallId, toolStatus) => {
    const taskId = toolCallId && taskIds.get(toolCallId)
    if (!taskId) return undefined
    switch (statuses.get(taskId)) {
      case 'pending':
      case 'in_progress':
        return toolStatus === 'cancelled' ? 'cancelled' : 'invoking'
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
}

function useSubagentStatusLookup(
  messageIds: readonly string[],
  rows: MessagePartRows,
  target?: ProjectionTarget
): TaskStatusLookup {
  const selected = useProjectedToolParts(target, rows, isTaskEvent)
  // Preserve row order across steer. A live row can gain its first event after this baseline.
  const eventRows = useMemo(() => {
    let ordered: (string | TaskEvent[])[] | undefined
    return () => {
      if (ordered) return ordered
      ordered = []
      for (const id of messageIds) {
        if (rows instanceof PartOverrides && rows.replacements.has(id)) ordered.push(id)
        else {
          const events = messagePartsAt(rows, id)?.filter(isTaskEvent)
          if (events?.length) ordered.push(events)
        }
      }
      return ordered
    }
  }, [messageIds, rows])
  return useMemo(() => {
    let lookup: TaskStatusLookup | undefined
    return (id, status) => {
      if (!lookup) {
        const live = selected instanceof PartOverrides ? selected.replacements : undefined
        lookup = buildStatusLookup(eventRows(), live)
      }
      return lookup(id, status)
    }
  }, [eventRows, selected])
}

export function SubagentStatusProvider({
  messageIds,
  rows,
  target,
  children
}: {
  messageIds: readonly string[]
  rows: MessagePartRows
  target?: ProjectionTarget
  children: ReactNode
}) {
  const lookup = useSubagentStatusLookup(messageIds, rows, target)
  return <SubagentStatusContext value={lookup}>{children}</SubagentStatusContext>
}
