import { createHash, randomUUID } from 'node:crypto'

import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import type {
  ForkContextCompatibility,
  ForkContextDocument,
  ForkContextSegment,
  ForkContextSnapshot,
  ForkContextSummary
} from '@shared/ai/agentSessionForkContext'

export function forkContextHash(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical)
    if (input !== null && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)])
      )
    return input
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}

export function createForkContextSnapshot(rows: readonly AgentSessionMessageRow[]): ForkContextSnapshot {
  let turnId = rows[0]?.id ?? ''
  const entries: ForkContextSnapshot['entries'] = rows.map((row, ordinal) => {
    if (row.role === 'user') turnId = row.id
    const text = (row.data.parts ?? [])
      .flatMap((part) => {
        if (part.type === 'text') return [part.text]
        if (part.type === 'file')
          return [
            `Attachment reference: ${part.filename ?? 'file'} (${part.mediaType}). Contents not inherited; reattach if needed.`
          ]
        if ('toolCallId' in part) {
          const result = 'output' in part ? part.output : 'errorText' in part ? part.errorText : undefined
          return [
            `Historical tool ${part.type === 'dynamic-tool' ? part.toolName : part.type}: ${JSON.stringify(result) ?? 'no saved result'}. Not an action to execute.`
          ]
        }
        return []
      })
      .join('\n')
    return {
      ordinal,
      messageId: row.id,
      turnId,
      role: row.role === 'user' || row.role === 'assistant' ? row.role : ('mixed' as const),
      text,
      contentHash: forkContextHash({ role: row.role, parts: row.data.parts ?? [] }),
      isMultimodalReference: (row.data.parts ?? []).some((part) => part.type === 'file')
    }
  })
  return {
    snapshotId: randomUUID(),
    entries,
    hadCompaction: rows.some((row) =>
      row.data.parts?.some((part) => part.type === 'data-compaction-anchor' && part.data.status === 'done')
    ),
    hash: forkContextHash(entries)
  }
}

export function forkContextSegment(
  snapshot: ForkContextSnapshot,
  start: number,
  end: number,
  text: string,
  kind: ForkContextSegment['kind']
): ForkContextSegment {
  const entries = snapshot.entries.slice(start, end)
  const segment = {
    segmentId: randomUUID(),
    kind,
    sourceRole: entries.length === 1 ? entries[0].role : ('mixed' as const),
    text,
    sourceSnapshotId: snapshot.snapshotId,
    sourceMessageIds: entries.map((entry) => entry.messageId),
    sourceRanges: [{ start, end }],
    isMultimodalReference: entries.some((entry) => entry.isMultimodalReference)
  }
  return { ...segment, contentHash: forkContextHash(segment) }
}

export function validForkContextSegment(segment: ForkContextSegment, snapshot: ForkContextSnapshot): boolean {
  const { contentHash, ...content } = segment
  if (contentHash !== forkContextHash(content) || segment.sourceSnapshotId !== snapshot.snapshotId) return false
  if (segment.sourceRanges.some(({ start, end }) => start >= end || end > snapshot.entries.length)) return false
  const ids = segment.sourceRanges.flatMap(({ start, end }) =>
    snapshot.entries.slice(start, end).map((e) => e.messageId)
  )
  return JSON.stringify(ids) === JSON.stringify(segment.sourceMessageIds)
}

export function hasCompleteForkContextCoverage(segments: readonly ForkContextSegment[], end: number): boolean {
  const ranges = segments.flatMap((segment) => segment.sourceRanges).sort((a, b) => a.start - b.start)
  let covered = 0
  for (const range of ranges) {
    if (range.start !== covered || range.end <= range.start) return false
    covered = range.end
  }
  return covered === end
}

export function selectForkContextSummary(
  document: ForkContextDocument,
  compatibility: ForkContextCompatibility
): ForkContextSummary | undefined {
  const snapshot = document.snapshot
  if (snapshot.hash !== forkContextHash(snapshot.entries)) return undefined
  const byId = new Map(document.summaries.map((summary) => [summary.summaryId, summary]))
  if (
    byId.size !== document.summaries.length ||
    snapshot.entries.some((entry, index) => entry.ordinal !== index) ||
    new Set(snapshot.entries.map((entry) => entry.messageId)).size !== snapshot.entries.length
  )
    return undefined
  const visited = new Set<string>()
  let id = document.headSummaryId
  let selected: ForkContextSummary | undefined
  while (id) {
    if (visited.has(id)) return undefined
    visited.add(id)
    const summary = byId.get(id)
    if (
      !summary ||
      summary.inputSnapshotId !== snapshot.snapshotId ||
      summary.coveredStart !== 0 ||
      summary.coveredEnd > snapshot.entries.length ||
      summary.inputSnapshotHash !== forkContextHash(snapshot.entries.slice(0, summary.coveredEnd)) ||
      JSON.stringify(summary.inputMessageIds) !==
        JSON.stringify(snapshot.entries.slice(0, summary.coveredEnd).map((e) => e.messageId))
    )
      return undefined
    const segments = [...summary.segments, ...summary.retainedSegments]
    if (
      new Set(summary.layout).size !== segments.length ||
      summary.layout.length !== segments.length ||
      segments.some(
        (segment) =>
          !summary.layout.includes(segment.segmentId) ||
          !validForkContextSegment(segment, snapshot) ||
          segment.sourceRanges.some((range) => range.end > summary.coveredEnd)
      )
    )
      return undefined
    const ranges = segments.flatMap((segment) => segment.sourceRanges).sort((a, b) => a.start - b.start)
    let covered = 0
    for (const range of ranges) {
      if (range.start !== covered) return undefined
      covered = range.end
    }
    if (covered !== summary.coveredEnd) return undefined
    if (!selected && forkContextHash(summary.compatibility) === forkContextHash(compatibility)) selected = summary
    if (summary.parentSummaryId) {
      const parent = byId.get(summary.parentSummaryId)
      if (!parent || parent.coveredEnd > summary.coveredEnd) return undefined
    }
    id = summary.parentSummaryId
  }
  return selected
}

export function collectForkContextGarbage(document: ForkContextDocument): void {
  const byId = new Map(document.summaries.map((summary) => [summary.summaryId, summary]))
  const roots = [
    document.headSummaryId,
    document.prepared?.summaryId,
    ...document.audits.map((audit) => audit.summaryId)
  ]
  const reachable = new Set<string>()
  for (let id of roots) {
    while (id && !reachable.has(id)) {
      reachable.add(id)
      id = byId.get(id)?.parentSummaryId
    }
  }
  document.summaries = document.summaries.filter((summary) => reachable.has(summary.summaryId))
}

export function nativeForkContextText(messages: readonly unknown[]): string {
  const text = messages.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const message = value as Record<string, unknown>
    if (message.role === 'system' || message.role === 'developer') return []
    const content =
      typeof message.summary === 'string'
        ? message.summary
        : typeof message.content === 'string'
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .flatMap((part) =>
                  part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string'
                    ? [part.text]
                    : []
                )
                .join('\n')
            : ''
    return content ? [{ role: String(message.role ?? 'mixed'), text: content }] : []
  })
  return text.length ? JSON.stringify(text) : ''
}
