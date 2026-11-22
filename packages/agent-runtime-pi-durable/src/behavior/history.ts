import {
  AssistantEntry,
  defineDoc,
  GenerationTask,
  InboxDoc,
  CompactionEntry,
  LiveDoc,
  ToolResultEntry,
  ToolTask,
  type ConversationId,
  type Cursor,
  type EntryRecord,
  type EntryId,
  type GenerationInput,
  type Page,
  type TaskRecord,
  type TaskId,
  type ToolTaskInput,
  type Tx
} from '@earendil-works/pi-durable'

import {
  callKeyOf,
  decodeEntry,
  type ConversationFacts,
  type HistoryEntry,
  type PlanState,
  type SubagentOrigin,
  type UsageFact
} from '@cherrystudio/agent-behavior/policy'
import type { GoalOwner } from '@cherrystudio/agent-behavior/policy'
import { runtimeId, type JsonValue, type ThreadId } from '@cherrystudio/agent-runtime'

export const threadId = (id: ConversationId): ThreadId => runtimeId(String(id))

const BLOCKED_PREFIX = 'Tool call blocked: '
/** The reason the gate blocked a call with, from the `blocked` diagnostic the Harness stores with its result. */
function blockedReason(entry: EntryRecord): string | undefined {
  if (!ToolResultEntry.is(entry)) return undefined
  const message = entry.data.diagnostics.find(({ code }) => code === 'blocked')?.message
  return message?.startsWith(BLOCKED_PREFIX) ? message.slice(BLOCKED_PREFIX.length) : undefined
}

export const nativeSummaryUsage = defineDoc({
  kind: 'cherry.native-summary-usage',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  checkpointWhen: () => false,
  initial: (): { records: Record<string, { owner: GoalOwner; usage: UsageFact; runId?: number }> } => ({ records: {} })
})
export function conversationId(thread: ThreadId): ConversationId {
  const id = Number(thread)
  if (!Number.isSafeInteger(id) || id < 0 || String(id) !== thread)
    throw new Error(`Invalid Durable conversation ${thread}`)
  return id as ConversationId
}

export async function pages<T>(read: (cursor?: Cursor) => Promise<Page<T, Cursor>>): Promise<T[]> {
  const items: T[] = []
  let cursor: Cursor | undefined
  do {
    const page = await read(cursor)
    items.push(...page.items)
    cursor = page.next
  } while (cursor)
  return items
}

function summaryUsage(entry: EntryRecord) {
  if (!CompactionEntry.is(entry)) return undefined
  const metadata = entry.data.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || typeof metadata.kind !== 'string')
    return undefined
  const decoded = decodeEntry({ id: runtimeId(String(entry.id)), kind: metadata.kind, data: metadata.data })
  return decoded?.kind === 'record' && decoded.record.type === 'summary-usage' ? decoded : undefined
}

type Task = TaskRecord<JsonValue, JsonValue, JsonValue>
type AssistantItem = Extract<HistoryEntry, { kind: 'assistant' }>
type ToolResultItem = Extract<HistoryEntry, { kind: 'tool-result' }>
type Usage = { -readonly [K in keyof UsageFact]: number }

export const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 }

function addUsage(total: Usage, usage: UsageFact) {
  total.input += usage.input
  total.output += usage.output
  total.cacheRead += usage.cacheRead
  total.cacheWrite += usage.cacheWrite
  total.totalTokens += usage.totalTokens
  total.costUsd += usage.costUsd
}

export function taskRun(task: Task): TaskId {
  return (task.input as GenerationInput).runId ?? task.id
}

/**
 * One conversation's lineage history and what behavior reads from it, folded one record at a time. Entries fold in ID
 * order and tasks in ID order per conversation; a row at or below what was already folded is ignored. Tasks may
 * interleave with entries in any way: a tool task folded after its assistant entry rewrites that call's key, and the
 * keys of tool results that resolved through that call.
 */
export class HistoryFold {
  readonly history: HistoryEntry[] = []
  backgroundVersion = 0
  hasBackgroundEvidence = false
  /** History length after each folded entry, for reads limited to an earlier entry. */
  readonly ends: { readonly entry: EntryId; readonly end: number }[] = []
  /** Newest folded task of each lineage conversation. */
  readonly newestTasks = new Map<ConversationId, TaskId | undefined>()
  /** Children named by run records, with the history index of each child's first record. */
  readonly children = new Map<ThreadId, number>()
  readonly origins: { readonly at: number; readonly value: SubagentOrigin }[] = []
  plan: PlanState | undefined
  /** History index of the latest user input or marker, where the current turn began. */
  turn = -1
  /** Own run reservations whose submission may still bind a run, and the run number reserved for each bound run. */
  readonly reservations: { readonly key: string; readonly run: number }[] = []
  readonly reserved = new Map<TaskId, number>()
  readonly runs = new Set<TaskId>()
  /** Newest own generation task of each run and overall; unfinished ones are reread on each catch-up. */
  readonly runTasks = new Map<TaskId, TaskId>()
  generation: Task | undefined
  readonly jobs = new Map<TaskId, Task>()
  /** Usage and the last assistant reply of each run, from this conversation's own entries. */
  readonly usage = new Map<TaskId, Usage>()
  readonly replies = new Map<TaskId, { readonly text: string; readonly stop: string; readonly error?: string }>()
  /** Tool calls of the lineage's latest assistant message, and the calls answered after it. */
  latestCalls: readonly { readonly id: string; readonly name: string }[] = []
  readonly answered = new Set<string>()
  readonly #toolTasks = new Map<string, string>()
  readonly #calls = new Map<string, { readonly at: number; readonly index: number }[]>()
  readonly #assignments = new Map<string, { readonly at: number; readonly call: string; key: string }[]>()
  readonly #fallbacks = new Map<string, number[]>()

  constructor(readonly owner: ConversationId) {
    this.newestTasks.set(owner, undefined)
  }

  /** Run IDs by run number; a number reserved past the runs before it leaves gaps. */
  runIds(): (TaskId | undefined)[] {
    const ids: (TaskId | undefined)[] = []
    for (const run of [...this.runs].sort((a, b) => a - b)) {
      const number = Math.max(ids.length + 1, this.reserved.get(run) ?? 0)
      while (ids.length < number - 1) ids.push(undefined)
      ids.push(run)
    }
    return ids
  }

  addTask(task: Task) {
    if (task.id <= (this.newestTasks.get(task.conversationId) ?? -1)) return
    this.newestTasks.set(task.conversationId, task.id)
    if (task.conversationId === this.owner && task.kind === GenerationTask.definition.name) {
      this.runs.add(taskRun(task))
      this.runTasks.set(taskRun(task), task.id)
      this.generation = task
    }
    if (task.conversationId === this.owner && task.kind === 'cherry.behavior-job' && task.state.status !== 'terminal')
      this.jobs.set(task.id, task)
    if (task.kind !== ToolTask.definition.name) return
    const input = task.input as ToolTaskInput
    if (input.kind !== 'model') return
    const call = `${input.assistant}:${input.callId}`
    const key = String(task.id)
    this.#toolTasks.set(call, key)
    const assigned = this.#calls.get(call)
    if (assigned) this.backgroundVersion++
    for (const { at, index } of assigned ?? []) {
      const item = this.history[at] as AssistantItem
      this.history[at] = {
        ...item,
        toolCalls: item.toolCalls.map((fact, position) =>
          position === index ? { ...fact, callKey: callKeyOf(key) } : fact
        )
      }
    }
    for (const assignment of this.#assignments.get(input.callId) ?? [])
      if (assignment.call === call) assignment.key = key
    for (const at of this.#fallbacks.get(input.callId) ?? []) {
      const item = this.history[at] as ToolResultItem
      this.history[at] = { ...item, callKey: callKeyOf(this.#resolve(input.callId, at) ?? input.callId) }
    }
  }

  addEntry(entry: EntryRecord) {
    if (entry.id <= (this.ends.at(-1)?.entry ?? -1)) return
    if (!this.newestTasks.has(entry.conversationId)) this.newestTasks.set(entry.conversationId, undefined)
    const id = runtimeId<'item'>(String(entry.id))
    const model = entry.kind === 'cherry.reference-context' ? [] : (entry.model ?? [])
    const text = model
      .flatMap((message) =>
        typeof message.content === 'string'
          ? [message.content]
          : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      )
      .join('\n')
    const decoded = decodeEntry({ id, kind: entry.kind, data: entry.data, text })
    if (decoded) {
      if (decoded.kind !== 'record' || entry.conversationId === this.owner) this.#push(decoded)
    } else if (CompactionEntry.is(entry)) {
      const accounting = entry.conversationId === this.owner ? summaryUsage(entry) : undefined
      if (accounting) this.#push(accounting)
      this.#push({ kind: 'compaction', id })
    } else
      for (const message of model) {
        if (message.role === 'user') this.#push({ kind: 'user', id, text })
        else if (message.role === 'assistant') {
          if (message.stopReason === 'pending' || message.stopReason === 'deferred') continue
          const at = this.history.length
          const toolCalls = message.content.flatMap((part) => {
            if (part.type !== 'toolCall') return []
            const call = `${entry.id}:${part.id}`
            return [
              {
                callId: part.id,
                callKey: callKeyOf(this.#toolTasks.get(call) ?? call),
                name: part.name,
                args: part.arguments
              }
            ]
          })
          toolCalls.forEach((fact, index) => {
            const call = `${entry.id}:${fact.callId}`
            this.#calls.set(call, [...(this.#calls.get(call) ?? []), { at, index }])
            this.#assignments.set(fact.callId, [
              ...(this.#assignments.get(fact.callId) ?? []),
              { at, call, key: this.#toolTasks.get(call) ?? call }
            ])
          })
          this.#push({
            kind: 'assistant',
            id,
            text,
            toolCalls,
            stop: message.stopReason,
            error: message.errorMessage,
            usage: {
              input: message.usage.input,
              output: message.usage.output,
              cacheRead: message.usage.cacheRead,
              cacheWrite: message.usage.cacheWrite,
              totalTokens: message.usage.totalTokens,
              costUsd: message.usage.cost.total
            }
          })
        } else if (message.role === 'toolResult') {
          const at = this.history.length
          if (entry.byTaskId === undefined)
            this.#fallbacks.set(message.toolCallId, [...(this.#fallbacks.get(message.toolCallId) ?? []), at])
          const blocked = blockedReason(entry)
          this.#push({
            kind: 'tool-result',
            id,
            callId: message.toolCallId,
            callKey: callKeyOf(String(entry.byTaskId ?? this.#resolve(message.toolCallId, at) ?? message.toolCallId)),
            tool: message.toolName,
            text,
            isError: message.isError,
            details: message.details,
            ...(blocked === undefined ? {} : { blocked })
          })
        }
      }
    this.ends.push({ entry: entry.id, end: this.history.length })
    if (entry.conversationId === this.owner) this.#addOwn(entry)
    for (const message of model) {
      if (message.role === 'assistant') {
        this.latestCalls = message.content.flatMap((part) =>
          part.type === 'toolCall' ? [{ id: part.id, name: part.name }] : []
        )
        this.answered.clear()
      } else if (message.role === 'toolResult') this.answered.add(message.toolCallId)
    }
  }

  #addOwn(entry: EntryRecord) {
    const data = entry.data as { key?: string; cherryRun?: number } | undefined
    if (data?.key && data.cherryRun !== undefined) this.reservations.push({ key: data.key, run: data.cherryRun })
    if (!AssistantEntry.is(entry) && !CompactionEntry.is(entry)) return
    const runId = entry.data.runId
    if (runId === undefined) return
    let usage = this.usage.get(runId)
    if (!usage) this.usage.set(runId, (usage = { ...ZERO_USAGE }))
    const summary = summaryUsage(entry)
    if (summary?.record.type === 'summary-usage') addUsage(usage, summary.record.value.usage)
    for (const message of entry.model ?? []) {
      if (message.role !== 'assistant') continue
      addUsage(usage, { ...message.usage, costUsd: message.usage.cost.total })
      if (AssistantEntry.is(entry))
        this.replies.set(runId, {
          text: message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''),
          stop: message.stopReason,
          error: message.errorMessage
        })
    }
  }

  #push(item: HistoryEntry) {
    const at = this.history.length
    this.history.push(item)
    const notification = item.kind === 'marker' && item.marker.type === 'subagent-notification'
    const childRun = item.kind === 'record' && item.record.type === 'subagent-run'
    if (notification || childRun) this.hasBackgroundEvidence = true
    if (
      item.kind === 'user' ||
      item.kind === 'assistant' ||
      notification ||
      childRun ||
      (item.kind === 'marker' && item.marker.type === 'goal-round') ||
      (item.kind === 'record' && item.record.type === 'subagent-origin')
    )
      this.backgroundVersion++
    if (item.kind === 'user' || item.kind === 'marker') this.turn = at
    if (item.kind !== 'record') return
    const { record } = item
    if (record.type === 'subagent-run' && !this.children.has(record.value.sessionId))
      this.children.set(record.value.sessionId, at)
    if (record.type === 'subagent-origin') this.origins.push({ at, value: record.value })
    if (record.type === 'plan') this.plan = record.value
  }

  // A tool result without a task takes the key of the latest earlier call with its call ID.
  #resolve(callId: string, at: number): string | undefined {
    return this.#assignments.get(callId)?.findLast((assignment) => assignment.at < at)?.key
  }
}

export function historyOf(
  entries: readonly EntryRecord[],
  tasks: readonly Task[],
  owner: ConversationId
): HistoryEntry[] {
  const fold = new HistoryFold(owner)
  for (const task of tasks) fold.addTask(task)
  for (const entry of entries) fold.addEntry(entry)
  return fold.history
}

/**
 * Advances a fold to the transaction's committed state. One mutation line mints IDs in commit order and never deletes
 * tasks, so rows newer than the fold's cursors are exactly the unseen ones; only unfinished tasks and runless
 * reservations are reread.
 */
async function catchUp(tx: Tx, fold: HistoryFold) {
  for (const id of [...fold.jobs.keys()]) {
    const task = (await tx.task(id))!
    if (task.state.status === 'terminal') fold.jobs.delete(id)
    else fold.jobs.set(id, task)
  }
  if (fold.generation && fold.generation.state.status !== 'terminal')
    fold.generation = (await tx.task(fold.generation.id))!
  const after = fold.ends.at(-1)?.entry
  let cursor: Cursor | undefined
  do {
    const page = await tx.scanEntries(
      {
        conversationId: fold.owner,
        order: 'ascending',
        ...(after !== undefined && { minEntryId: (after + 1) as EntryId })
      },
      256,
      cursor
    )
    for (const entry of page.items) fold.addEntry(entry)
    cursor = page.next
  } while (cursor)
  for (const [conversationId, newest] of fold.newestTasks) {
    const fresh: Task[] = []
    let next: Cursor | undefined
    // Pages grow from one task, so a conversation with no new task costs one row.
    for (let limit = 1; ; limit = Math.min(limit * 2, 256)) {
      const page = await tx.scanTasks({ conversationId, order: 'descending' }, limit, next)
      const seen = page.items.findIndex((task) => newest !== undefined && task.id <= newest)
      fresh.push(...(seen < 0 ? page.items : page.items.slice(0, seen)))
      next = page.next
      if (seen >= 0 || !next) break
    }
    for (const task of fresh.reverse()) fold.addTask(task)
  }
  for (const reservation of [...fold.reservations]) {
    const input = await tx.submissionByRequest(fold.owner, reservation.key)
    if (
      !input ||
      (input.type === 'input' && input.runId === undefined && (input.status === 'queued' || input.status === 'placed'))
    )
      continue
    fold.reservations.splice(fold.reservations.indexOf(reservation), 1)
    if (input.type === 'input' && input.runId !== undefined && input.runId > input.id)
      fold.reserved.set(input.runId, Math.max(fold.reserved.get(input.runId) ?? 0, reservation.run))
  }
}

const FOLD_TTL_MS = 10 * 60_000

/** Folds of one runtime's conversations, advanced inside the transaction that reads them. */
export class DurableFolds {
  readonly #folds = new Map<ConversationId, { readonly fold: HistoryFold; used: number }>()

  async advance(tx: Tx, id: ConversationId): Promise<HistoryFold> {
    const now = Date.now()
    for (const [key, held] of this.#folds) if (now - held.used > FOLD_TTL_MS) this.#folds.delete(key)
    let held = this.#folds.get(id)
    if (!held) this.#folds.set(id, (held = { fold: new HistoryFold(id), used: now }))
    held.used = now
    await catchUp(tx, held.fold)
    return held.fold
  }

  clear() {
    this.#folds.clear()
  }
}

export async function readFacts(
  tx: Tx,
  folds: DurableFolds,
  id: ConversationId,
  abandoned: ReadonlySet<TaskId> = new Set(),
  at?: EntryId
): Promise<ConversationFacts> {
  const fold = await folds.advance(tx, id)
  const end = at === undefined ? fold.history.length : (fold.ends.findLast((item) => item.entry <= at)?.end ?? 0)
  const history = fold.history.slice(0, end)
  const summaries = await tx.doc(nativeSummaryUsage, id)
  for (const [key, value] of Object.entries(summaries.records)) {
    history.push({
      kind: 'record',
      id: runtimeId(`native-summary:${key}`),
      record: { type: 'summary-usage', value: { ...value.owner, usage: { ...value.usage } } }
    })
  }
  const live = await tx.doc(LiveDoc, id)
  const inbox = await tx.doc(InboxDoc, id)
  const record = (await tx.conversation(id))!
  const origin = fold.origins.findLast((item) => item.at < end)?.value
  const children = new Map<
    ThreadId,
    { running: boolean; runUsage: UsageFact[]; lastItem: ReturnType<typeof runtimeId<'item'>> }
  >()
  for (const [child, first] of fold.children) {
    if (first >= end) continue
    const childId = conversationId(child)
    const childFold = await folds.advance(tx, childId)
    const childLive = await tx.doc(LiveDoc, childId)
    const ids = childFold.runIds()
    const runUsage = Array.from(ids, () => ({ ...ZERO_USAGE }))
    const childSummaries = await tx.doc(nativeSummaryUsage, childId)
    for (const value of Object.values(childSummaries.records)) {
      const run = ids.findIndex((id) => id === value.runId)
      if (run >= 0) addUsage(runUsage[run], value.usage)
    }
    ids.forEach((run, index) => {
      const usage = run === undefined ? undefined : childFold.usage.get(run)
      if (usage) addUsage(runUsage[index], usage)
    })
    children.set(child, {
      running: childLive.run !== undefined,
      runUsage,
      lastItem: runtimeId(String(childFold.ends.at(-1)!.entry))
    })
  }
  const keysSeen = new Set(history.flatMap((entry) => ('key' in entry && entry.key ? [entry.key] : [])))
  for (const task of fold.jobs.values()) {
    const input = task.input as { key?: string }
    if (task.abortReason !== 'restart' && !abandoned.has(task.id) && input.key) keysSeen.add(input.key)
  }
  const outcome = fold.generation?.state.outcome
  return {
    thread: threadId(id),
    lineage:
      record.owner && origin
        ? { kind: 'subagent', parent: threadId(record.owner.conversationId), origin }
        : { kind: 'root' },
    history,
    children,
    keysSeen,
    live: {
      idle: !live.run && inbox.items.length === 0,
      leftoverInputs: live.run ? 0 : inbox.items.filter((item) => item.mode !== 'write').length,
      queuedUserInput: inbox.items.some((item) => item.mode !== 'write' && !item.entry),
      hostCallInFlight: false,
      ...(!live.run && outcome
        ? {
            runEnd: {
              outcome:
                outcome.status === 'aborted'
                  ? ('aborted' as const)
                  : outcome.status === 'completed'
                    ? ('completed' as const)
                    : ('error' as const)
            }
          }
        : {})
    }
  }
}
