import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'

type HistoryRow = Pick<
  AgentSessionMessageRow,
  'id' | 'role' | 'replyId' | 'pos' | 'inputContextId' | 'nativeInputId' | 'data' | 'parentId' | 'status'
>

function unplacedAgentRunInputs(rows: readonly HistoryRow[]): Set<string> {
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
          !row.data.nativePlaced &&
          !row.data.locallyHandled &&
          !row.data.importedHistory &&
          (row.inputContextId !== null || row.nativeInputId !== null) &&
          !legacyInputs.has(row.id) &&
          !(row.replyId && completedRuns.has(row.replyId))
      )
      .map((row) => row.id)
  )
}

function orderAgentSessionRuns<T extends HistoryRow>(rows: readonly T[]): T[] {
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

const planIdentity: unique symbol = Symbol('agent-session-history-plan')

export type RunHistoryBoundary = Readonly<Pick<AgentSessionMessageRow, 'id' | 'role' | 'status'> & { anchor: unknown }>

export type RunEditResolution =
  | { kind: 'invalid' | 'steer' | 'unplaced' }
  | { readonly [planIdentity]: 'edit-target'; kind: 'ready'; readonly boundary: RunHistoryBoundary | null }

export interface RunEditPlan {
  readonly [planIdentity]: 'edit'
  readonly targetInputId: string
  readonly prefixIds: readonly string[]
  readonly resolution: Extract<RunEditResolution, { kind: 'ready' }>
  readonly parentChanges: readonly Readonly<{ messageId: string; parentId: string | null }>[]
  readonly retainedHeadId: string | null
}

interface RunForkPlan {
  readonly [planIdentity]: 'fork'
  readonly messageIds: readonly string[]
}

function boundary(row: AgentSessionMessageRow): RunHistoryBoundary {
  return { id: row.id, role: row.role, status: row.status, anchor: row.data.runtimeAnchor }
}

class AgentSessionRunHistory {
  private readonly rows: AgentSessionMessageRow[]
  private readonly byId: Map<string, AgentSessionMessageRow>
  private readonly unplaced: Set<string>
  private readonly edits = new Map<string, RunEditResolution>()

  constructor(rows: readonly AgentSessionMessageRow[]) {
    this.rows = orderAgentSessionRuns(rows)
    this.byId = new Map(rows.map((row) => [row.id, row]))
    this.unplaced = unplacedAgentRunInputs(rows)
    const firstInputs = new Set<string>()
    let previous: AgentSessionMessageRow | undefined
    for (const row of this.rows) {
      const predecessor =
        previous?.role === 'user' && previous.replyId ? (this.byId.get(previous.replyId) ?? previous) : previous
      if (row.role === 'user') {
        const kind = row.delivery
          ? 'invalid'
          : this.unplaced.has(row.id)
            ? 'unplaced'
            : row.replyId && (firstInputs.has(row.replyId) || row.replyId === predecessor?.id)
              ? 'steer'
              : 'ready'
        this.edits.set(
          row.id,
          kind === 'ready'
            ? {
                [planIdentity]: 'edit-target',
                kind,
                boundary: predecessor ? boundary(predecessor) : null
              }
            : { kind }
        )
        if (row.replyId && !this.unplaced.has(row.id)) firstInputs.add(row.replyId)
      }
      if (!this.unplaced.has(row.id)) previous = row
    }
  }

  inspect(messageId: string) {
    const row = this.byId.get(messageId)
    return row && { ...boundary(row), edit: this.edits.get(messageId) ?? { kind: 'invalid' as const } }
  }

  edit(messageId: string): Exclude<RunEditResolution, { kind: 'ready' }> | { kind: 'ready'; plan: RunEditPlan } {
    const resolution = this.edits.get(messageId) ?? { kind: 'invalid' as const }
    if (resolution.kind !== 'ready') return resolution
    const index = this.rows.findIndex((row) => row.id === messageId)
    const prefix = this.rows.slice(0, index).filter((row) => !this.unplaced.has(row.id))
    return {
      kind: 'ready' as const,
      plan: {
        [planIdentity]: 'edit' as const,
        targetInputId: messageId,
        prefixIds: prefix.filter((row) => row.role !== 'root').map((row) => row.id),
        resolution,
        parentChanges: this.rows
          .filter((row) => row.role !== 'root')
          .map((row, index, rows) => ({
            messageId: row.id,
            parentId: rows[index - 1]?.id ?? this.rows.find((row) => row.role === 'root')?.id ?? null
          }))
          .filter((change) => this.byId.get(change.messageId)!.parentId !== change.parentId),
        retainedHeadId: this.rows[index - 1]?.id ?? null
      }
    }
  }

  fork(messageId: string, excludedIds: readonly string[]): RunForkPlan | undefined {
    const rows = this.rows.filter((row) => row.role !== 'root' && !this.unplaced.has(row.id))
    const selected = rows.findIndex((row) => row.id === messageId)
    if (selected < 0) return
    const end = rows.reduce((end, row, index) => (row.replyId === messageId ? Math.max(end, index) : end), selected)
    const excluded = new Set(excludedIds)
    return {
      [planIdentity]: 'fork',
      messageIds: rows
        .slice(0, end + 1)
        .filter((row) => !excluded.has(row.id))
        .map((row) => row.id)
    }
  }
}

export function resolveAgentSessionRunHistory(rows: readonly AgentSessionMessageRow[]) {
  return new AgentSessionRunHistory(rows)
}
