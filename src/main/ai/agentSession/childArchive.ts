import type { AgentSessionCheckpoints, AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { projectMessagePartForRenderer } from '@main/utils/messageOutputProjection'
import type { AgentChildView } from '@shared/ai/agentChildProjection'
import { buildAgentSessionTopicId } from '@shared/ai/agentSessionTopic'
import type { DeferredToolResultRef } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'

export type Composition = NonNullable<NonNullable<AgentSessionCheckpoints['child']>['composition']>
export type ProjectedArchiveRow = { source: CherryUIMessage; view: CherryUIMessage }

export function savedMessages(sessionId: string): CherryUIMessage[] {
  return messages.readChildMessages(sessionId)
}

export function savedChildView(
  context: AgentSessionContextRow,
  saved: readonly CherryUIMessage[] = savedMessages(context.sessionId)
): AgentChildView {
  const groups = context.checkpointMapping?.child?.composition
  const composition: Composition = {}
  if (groups) for (const row of saved) if (groups[row.id]) composition[row.id] = groups[row.id]
  return archiveView(context, saved, composition, false, context.checkpointMapping?.child?.gap)
}

function archiveView(
  context: Pick<AgentSessionContextRow, 'id' | 'sessionId'>,
  rows: readonly CherryUIMessage[],
  composition: Composition,
  canSubmit: boolean,
  diagnostic?: string
): AgentChildView {
  const topicId = buildAgentSessionTopicId(context.sessionId)
  return {
    kind: 'child',
    contextId: context.id,
    sessionId: context.sessionId,
    revision: 0,
    active: false,
    available: false,
    canSubmit,
    diagnostic,
    messages: compose(new Map(rows.map((message) => [message.id, projectArchiveRow(message, topicId)])), composition)
  }
}

export function readChildPage(context: NonNullable<ReturnType<typeof contexts.childArchive>>, cursor?: string) {
  const page = messages.readChildPage(context.sessionId, cursor)
  const { diagnostic, composition } = contexts.childPageMetadata(
    context.id,
    page.items.map((row) => row.id)
  )
  return {
    ...archiveView(context, page.items, composition, context.canSubmit, diagnostic),
    olderCursor: page.nextCursor
  }
}

/** Saved rows are JSON, which drops undefined fields, so compare the way a reopened row reads back. */
export function storedEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => storedEqual(item, right[index]))
    )
  let fields = 0
  for (const [key, item] of Object.entries(left)) {
    if (item === undefined) continue
    fields++
    if (!storedEqual(item, (right as Record<string, unknown>)[key])) return false
  }
  return fields === Object.values(right).filter((item) => item !== undefined).length
}

export function projectArchiveRow(
  source: CherryUIMessage,
  topicId: string,
  before?: ProjectedArchiveRow,
  changedResults?: DeferredToolResultRef[]
): ProjectedArchiveRow {
  if (before?.source === source) return before
  const parts = source.parts.map((part, index) => {
    const partId = source.partIds?.[index]
    if (before && before.source.partIds?.[index] === partId && storedEqual(before.source.parts[index], part))
      return before.view.parts[index]
    if (part.type === 'dynamic-tool' && (part.state === 'output-available' || part.state === 'output-error'))
      changedResults?.push({ topicId, messageId: source.id, toolCallId: part.toolCallId, ...(partId && { partId }) })
    return projectMessagePartForRenderer(part, topicId, source.id, undefined, partId)
  })
  if (before && changedResults) invalidateRemovedResults(before.source, source, topicId, changedResults)
  return { source, view: { ...source, parts } }
}

export function invalidateRemovedResults(
  before: CherryUIMessage,
  next: CherryUIMessage | undefined,
  topicId: string,
  changedResults: DeferredToolResultRef[]
): void {
  before.parts.forEach((part, index) => {
    if (part.type !== 'dynamic-tool' || (part.state !== 'output-available' && part.state !== 'output-error')) return
    const partId = before.partIds?.[index]
    const current = next?.parts[index]
    if (
      current?.type === 'dynamic-tool' &&
      (current.state === 'output-available' || current.state === 'output-error') &&
      current.toolCallId === part.toolCallId &&
      next?.partIds?.[index] === partId
    )
      return
    changedResults.push({ topicId, messageId: before.id, toolCallId: part.toolCallId, ...(partId && { partId }) })
  })
}

export function compose(rows: ReadonlyMap<string, ProjectedArchiveRow>, composition: Composition): CherryUIMessage[] {
  const grouped = new Set(
    Object.values(composition).flatMap((fragments) => fragments.map((fragment) => fragment.messageId))
  )
  const messages: CherryUIMessage[] = []
  for (const { view: message } of rows.values()) {
    const fragments = composition[message.id]
    if (!fragments) {
      if (!grouped.has(message.id)) messages.push(message)
      continue
    }
    const parts: CherryUIMessage['parts'] = []
    const partIds: string[] = []
    let status: 'pending' | 'error' | undefined
    for (const fragment of fragments) {
      const row = rows.get(fragment.messageId)?.view
      if (!row) continue
      if (row.metadata?.status === 'pending') status = 'pending'
      else if (row.metadata?.status === 'error') status ??= 'error'
      for (const index of fragment.parts) {
        const part = row.parts[index]
        if (!part) continue
        parts.push(part)
        partIds.push(row.partIds?.[index] ?? '')
      }
    }
    messages.push({
      ...message,
      metadata: { ...message.metadata, status: status ?? message.metadata?.status },
      parts,
      partIds
    })
  }
  return messages
}
