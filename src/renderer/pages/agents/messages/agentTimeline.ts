import { isHiddenPart, isTimelineMarkerPart } from '@renderer/components/chat/messages/blocks/messagePartPresentation'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

export interface AgentTimelineRow {
  id: string
  kind?: 'content' | 'marker' | 'interrupted'
  showHeader?: boolean
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
  const latestRunInputs = new Map<string, number>()
  messages.forEach((message, index) => {
    if (message.role === 'user' && message.timeline?.pos != null && message.timeline.replyId)
      latestRunInputs.set(message.timeline.replyId, index)
  })
  const old = new Map(previous.map((row) => [row.id, row]))
  const rows: { row: AgentTimelineRow; anchor: number; order: number }[] = []
  messages.forEach((message, index) => {
    const current = read(message)
    const ids = current.partIds
    if (message.role !== 'assistant' || message.metadata?.provenance || !ids || ids.length !== current.parts.length) {
      rows.push({ row: { id: message.id, message, parts: current.parts, partIds: ids }, anchor: index, order: -1 })
      return
    }
    const groups: { anchor: number; kind: 'content' | 'marker'; parts: CherryMessagePart[]; ids: string[] }[] = []
    current.parts.forEach((part, partIndex) => {
      const pos = current.partPositions?.[partIndex]
      let anchor = index
      if (pos != null)
        for (const boundary of boundaries) {
          if (boundary.pos >= pos) break
          anchor = Math.max(anchor, boundary.index)
        }
      const kind = isTimelineMarkerPart(part) ? 'marker' : 'content'
      let group = groups.at(-1)
      if (!group || group.anchor !== anchor || group.kind !== kind || kind === 'marker') {
        group = { anchor, kind, parts: [], ids: [] }
        groups.push(group)
      }
      group.parts.push(part)
      group.ids.push(ids[partIndex])
    })
    const isWaitingForOutput = !groups.length && message.metadata?.status === 'pending'
    if (!groups.length && message.metadata?.status !== 'paused') {
      const anchor = isWaitingForOutput ? Math.max(index, latestRunInputs.get(message.id) ?? index) : index
      groups.push({ anchor, kind: 'content', parts: [], ids: [] })
    }
    const contents = groups.filter((group) => group.kind === 'content')
    const firstContent = contents[0]
    const visible = contents.filter((group) => group.parts.some((part) => !isHiddenPart(part)))
    groups.forEach((group) =>
      rows.push({
        anchor: group.anchor,
        order: index,
        row: {
          id:
            group.kind === 'marker'
              ? `${message.id}:marker:${group.ids[0]}`
              : group === firstContent
                ? message.id
                : `${message.id}:part:${group.ids[0]}`,
          kind: group.kind,
          showHeader: isWaitingForOutput || visible.includes(group),
          message,
          parts: group.parts,
          partIds: group.ids,
          sourceMessageId: message.id,
          isRunBoundary: group === visible.at(-1)
        }
      })
    )
    if (message.metadata?.status === 'paused')
      rows.push({
        anchor: Math.max(groups.at(-1)?.anchor ?? index, latestRunInputs.get(message.id) ?? index),
        order: index,
        row: {
          id: `${message.id}:interrupted`,
          kind: 'interrupted',
          showHeader: false,
          message,
          parts: [],
          partIds: [],
          sourceMessageId: message.id,
          isRunBoundary: false
        }
      })
  })
  return rows
    .sort((a, b) => a.anchor - b.anchor || a.order - b.order)
    .map(({ row }) => {
      const before = old.get(row.id)
      return before &&
        before.message === row.message &&
        before.isRunBoundary === row.isRunBoundary &&
        before.kind === row.kind &&
        before.showHeader === row.showHeader &&
        before.parts.length === row.parts.length &&
        before.parts.every((part, index) => part === row.parts[index]) &&
        before.partIds?.length === row.partIds?.length &&
        (!before.partIds || before.partIds.every((id, index) => id === row.partIds?.[index]))
        ? before
        : row
    })
}
