import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

type Rows = Readonly<Record<string, CherryMessagePart[]>>
export type MessagePartRows = Rows | PartOverrides

/** Sparse replacements share their baseline, including when the last part of a row is removed. */
export class PartOverrides {
  constructor(
    readonly base: MessagePartRows,
    readonly replacements: ReadonlyMap<string, CherryMessagePart[]>
  ) {}
}

export function messagePartsAt(rows: MessagePartRows | null | undefined, id: string): CherryMessagePart[] | undefined {
  if (rows instanceof PartOverrides) return rows.replacements.get(id) ?? messagePartsAt(rows.base, id)
  return rows && Object.hasOwn(rows, id) ? rows[id] : undefined
}

export function* messagePartEntries(rows: MessagePartRows): Generator<[string, CherryMessagePart[]]> {
  if (rows instanceof PartOverrides) {
    for (const [id, parts] of messagePartEntries(rows.base)) yield [id, rows.replacements.get(id) ?? parts]
    for (const entry of rows.replacements) if (!messagePartsAt(rows.base, entry[0])) yield entry
  } else {
    for (const id in rows) if (Object.hasOwn(rows, id)) yield [id, rows[id]]
  }
}

export function replyParts(history: Rows, replies: readonly CherryUIMessage[]): MessagePartRows {
  if (!replies.length) return history
  const live = new Map<string, CherryMessagePart[]>()
  for (const row of replies) {
    // An addressed empty row clears the body. An unaddressed placeholder leaves history visible.
    if (row.parts.length || row.partIds) live.set(row.id, row.parts)
  }
  return live.size ? new PartOverrides(history, live) : history
}

export function activeReplyIds(executions: readonly ActiveExecution[], replies: readonly CherryUIMessage[]): string[] {
  const ids = new Set<string>()
  for (const execution of executions) if (execution.anchorMessageId) ids.add(execution.anchorMessageId)
  for (const reply of replies) ids.add(reply.id)
  return [...ids]
}
