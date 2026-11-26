import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'

type HistoryRow = Pick<
  AgentSessionMessageRow,
  'id' | 'role' | 'replyId' | 'pos' | 'inputContextId' | 'nativeInputId' | 'data' | 'parentId' | 'status'
>

export function unplacedAgentRunInputs(rows: readonly HistoryRow[]): Set<string> {
  const claimed = new Set(rows.flatMap((row) => (row.role === 'user' && row.replyId ? [row.replyId] : [])))
  const completed = rows.filter((row) => row.role === 'assistant' && row.status === 'success' && row.data.runtimeAnchor)
  const completedRuns = new Set(completed.map((row) => row.id))
  const legacyInputs = new Set(completed.filter((row) => !claimed.has(row.id)).map((row) => row.parentId))
  return new Set(
    rows
      .filter(
        (row) =>
          row.role === 'user' &&
          row.pos === null &&
          !row.data.locallyHandled &&
          !row.data.importedHistory &&
          (row.inputContextId !== null || row.nativeInputId !== null) &&
          !legacyInputs.has(row.id) &&
          !(row.replyId && completedRuns.has(row.replyId))
      )
      .map((row) => row.id)
  )
}

export function orderAgentSessionRuns<T extends HistoryRow>(rows: readonly T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const unplaced = unplacedAgentRunInputs(rows)
  const inputs = new Map<string, T[]>()
  for (const row of rows) {
    if (row.role !== 'user' || !row.replyId || unplaced.has(row.id) || byId.get(row.replyId)?.role !== 'assistant')
      continue
    const owned = inputs.get(row.replyId) ?? []
    owned.push(row)
    inputs.set(row.replyId, owned)
  }
  const emitted = new Set<string>()
  const groups: { pos: number | null; rows: T[] }[] = []
  for (const row of rows) {
    const runId = inputs.has(row.id) ? row.id : row.replyId
    if (!runId || !inputs.has(runId) || unplaced.has(row.id)) {
      groups.push({ pos: null, rows: [row] })
      continue
    }
    if (emitted.has(runId)) continue
    emitted.add(runId)
    const ordered = inputs.get(runId)!.toSorted((a, b) => (a.pos ?? Infinity) - (b.pos ?? Infinity))
    groups.push({ pos: ordered[0].pos, rows: [ordered[0], byId.get(runId)!, ...ordered.slice(1)] })
  }
  const placed = groups.filter((group) => group.pos !== null).sort((a, b) => a.pos! - b.pos!)
  let index = 0
  return groups.flatMap((group) => (group.pos === null ? group.rows : placed[index++].rows))
}
