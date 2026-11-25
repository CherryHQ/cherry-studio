import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

export interface AgentTimelineRow {
  id: string
  message: CherryUIMessage
  parts: CherryMessagePart[]
  partIds?: readonly string[]
  sourceMessageId?: string
  isRunBoundary?: boolean
}

/** Positions determine presentation; the source message remains the durable execution owner. */
export function projectAgentTimeline(
  messages: readonly CherryUIMessage[],
  read: (message: CherryUIMessage) => CherryUIMessage,
  previous: readonly AgentTimelineRow[] = []
): AgentTimelineRow[] {
  const boundaries = messages
    .flatMap((message, index) =>
      message.role === 'user' && message.timeline?.pos != null ? [{ pos: message.timeline.pos, index }] : []
    )
    .sort((a, b) => a.pos - b.pos)
  const old = new Map(previous.map((row) => [row.id, row]))
  const rows: { row: AgentTimelineRow; anchor: number; order: number }[] = []
  messages.forEach((message, index) => {
    const current = read(message)
    const ids = current.partIds
    if (message.role !== 'assistant' || !ids || ids.length !== current.parts.length) {
      rows.push({ row: { id: message.id, message, parts: current.parts, partIds: ids }, anchor: index, order: -1 })
      return
    }
    const groups: { anchor: number; parts: CherryMessagePart[]; ids: string[] }[] = []
    current.parts.forEach((part, partIndex) => {
      const pos = current.partPositions?.[partIndex]
      let anchor = index
      if (pos != null)
        for (const boundary of boundaries) {
          if (boundary.pos >= pos) break
          anchor = Math.max(anchor, boundary.index)
        }
      let group = groups.at(-1)
      if (!group || group.anchor !== anchor) {
        group = { anchor, parts: [], ids: [] }
        groups.push(group)
      }
      group.parts.push(part)
      group.ids.push(ids[partIndex])
    })
    if (!groups.length) groups.push({ anchor: index, parts: [], ids: [] })
    groups.forEach((group, part) =>
      rows.push({
        anchor: group.anchor,
        order: index,
        row: {
          id: part === 0 ? message.id : `${message.id}:part:${group.ids[0]}`,
          message,
          parts: group.parts,
          partIds: group.ids,
          sourceMessageId: message.id,
          isRunBoundary: part === groups.length - 1
        }
      })
    )
  })
  return rows
    .sort((a, b) => a.anchor - b.anchor || a.order - b.order)
    .map(({ row }) => {
      const before = old.get(row.id)
      return before &&
        before.message === row.message &&
        before.isRunBoundary === row.isRunBoundary &&
        before.parts.length === row.parts.length &&
        before.parts.every((part, index) => part === row.parts[index]) &&
        before.partIds?.length === row.partIds?.length &&
        (!before.partIds || before.partIds.every((id, index) => id === row.partIds?.[index]))
        ? before
        : row
    })
}
