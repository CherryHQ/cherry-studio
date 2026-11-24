import {
  AssistantEntry,
  defineDoc,
  GenerationTask,
  InboxDoc,
  CompactionEntry,
  LiveDoc,
  ToolTask,
  type ConversationId,
  type Cursor,
  type EntryRecord,
  type EntryId,
  type GenerationInput,
  type Page,
  type TaskRecord,
  type TaskId,
  type Tx
} from '@earendil-works/pi-durable'

import {
  callKeyOf,
  decodeEntry,
  type ConversationFacts,
  type HistoryEntry,
  type UsageFact
} from '@cherrystudio/agent-behavior'
import type { GoalOwner } from '@cherrystudio/agent-behavior'
import { runtimeId, type ItemId, type JsonValue, type ThreadId } from '@cherrystudio/agent-runtime'

export function toolCallIdentity(task: Pick<TaskRecord<JsonValue, JsonValue, JsonValue>, 'version' | 'input'>) {
  const input = task.input
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  const kind = 'kind' in input ? input.kind : undefined
  const assistant = 'assistant' in input ? input.assistant : undefined
  if (kind === 'model' || (task.version === 1 && kind === undefined))
    return 'callId' in input && typeof input.callId === 'string'
      ? {
          kind: 'model' as const,
          id: input.callId,
          assistant:
            typeof assistant === 'number' && Number.isSafeInteger(assistant) && assistant >= 0 ? assistant : undefined
        }
      : undefined
  if (kind !== 'nested') return undefined
  const call = 'call' in input ? input.call : undefined
  return typeof call === 'object' &&
    call !== null &&
    !Array.isArray(call) &&
    'id' in call &&
    typeof call.id === 'string'
    ? { kind: 'nested' as const, id: call.id }
    : undefined
}

export const threadId = (id: ConversationId): ThreadId => runtimeId(String(id))

export const nativeSummaryUsage = defineDoc({
  kind: 'cherry.native-summary-usage',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  checkpointWhen: () => false,
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- Later persisted summary records need their owner and usage contract; inference from the empty initial object would omit it.
  initial: (): { records: Record<string, { owner: GoalOwner; usage: UsageFact; runId?: number }> } => ({ records: {} })
})

export function conversationId(thread: ThreadId): ConversationId {
  const id = Number(thread)

  if (!Number.isSafeInteger(id) || id < 0 || String(id) !== thread)
    throw new Error(`Invalid Durable conversation ${thread}`)

  // SAFETY: The SDK has no public numeric brand constructor; this canonical safe integer is used for a native conversation lookup.
  return id as ConversationId
}

export function entryId(item: ItemId): EntryId {
  const id = Number(item)
  if (!Number.isSafeInteger(id) || id < 0 || String(id) !== item) throw new Error(`Invalid Durable entry ${item}`)
  // SAFETY: The SDK has no public numeric brand constructor; the canonical entry ID is resolved by the native history lookup.
  return id as EntryId
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

export async function lineageEntries(tx: Tx, id: ConversationId, at?: EntryId): Promise<EntryRecord[]> {
  return pages((cursor) =>
    tx.scanEntries({ conversationId: id, order: 'ascending', ...(at && { maxEntryId: at }) }, 256, cursor)
  )
}

function summaryUsage(entry: EntryRecord) {
  if (!CompactionEntry.is(entry)) return undefined
  const metadata = entry.data.metadata

  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || typeof metadata.kind !== 'string')
    return undefined
  const decoded = decodeEntry({ id: runtimeId(String(entry.id)), kind: metadata.kind, data: metadata.data })

  return decoded?.kind === 'record' && decoded.record.type === 'summary-usage' ? decoded : undefined
}

export function historyOf(
  entries: readonly EntryRecord[],
  tasks: readonly TaskRecord<JsonValue, JsonValue, JsonValue>[],
  owner: ConversationId
): HistoryEntry[] {
  const calls = new Map<string, string>()

  for (const task of tasks) {
    if (task.kind !== ToolTask.definition.name) continue
    const input = toolCallIdentity(task)

    if (input?.kind === 'model' && input.assistant !== undefined)
      calls.set(`${input.assistant}:${input.id}`, String(task.id))
  }

  const callKeys = new Map<string, string>()

  return entries.flatMap((entry): HistoryEntry[] => {
    const id = runtimeId<'item'>(String(entry.id))
    const model = entry.model ?? []

    const text = model
      .flatMap((message) =>
        typeof message.content === 'string'
          ? [message.content]
          : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []))
      )
      .join('\n')

    const decoded = decodeEntry({ id, kind: entry.kind, data: entry.data, text })

    if (decoded?.kind === 'record' && entry.conversationId !== owner) return []

    if (decoded) return [decoded]

    if (CompactionEntry.is(entry)) {
      const accounting = entry.conversationId === owner ? summaryUsage(entry) : undefined

      return [...(accounting ? [accounting] : []), { kind: 'compaction', id }]
    }

    return model.flatMap((message): HistoryEntry[] => {
      if (message.role === 'user') return [{ kind: 'user', id, text }]

      if (message.role === 'assistant') {
        if (message.stopReason === 'pending' || message.stopReason === 'deferred') return []

        const toolCalls = message.content.flatMap((part) => {
          if (part.type !== 'toolCall') return []
          const key = calls.get(`${entry.id}:${part.id}`) ?? `${entry.id}:${part.id}`
          callKeys.set(part.id, key)

          return [{ callId: part.id, callKey: callKeyOf(key), name: part.name, args: part.arguments }]
        })

        return [
          {
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
          }
        ]
      }

      if (message.role === 'toolResult')
        return [
          {
            kind: 'tool-result',
            id,
            callId: message.toolCallId,
            callKey: callKeyOf(String(entry.byTaskId ?? callKeys.get(message.toolCallId) ?? message.toolCallId)),
            tool: message.toolName,
            text,
            isError: message.isError,
            details: message.details
          }
        ]

      return []
    })
  })
}

export async function readFacts(
  tx: Tx,
  id: ConversationId,
  abandoned: ReadonlySet<TaskId> = new Set(),
  at?: EntryId
): Promise<ConversationFacts> {
  const entries = await lineageEntries(tx, id, at)

  const tasks = (
    await Promise.all(
      [...new Set([id, ...entries.map((entry) => entry.conversationId)])].map((conversationId) =>
        pages((cursor) => tx.scanTasks({ conversationId }, 256, cursor))
      )
    )
  ).flat()

  const history = historyOf(entries, tasks, id)
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
  const origin = history.findLast((entry) => entry.kind === 'record' && entry.record.type === 'subagent-origin')

  const children = new Map<
    ThreadId,
    { running: boolean; runUsage: UsageFact[]; lastItem: ReturnType<typeof runtimeId<'item'>> }
  >()

  const childIds = new Set(
    history.flatMap((entry) =>
      entry.kind === 'record' && entry.record.type === 'subagent-run' ? [entry.record.value.sessionId] : []
    )
  )

  for (const child of childIds) {
    const childId = conversationId(child)
    const childEntries = await lineageEntries(tx, childId)
    const childLive = await tx.doc(LiveDoc, childId)
    const childTasks = await pages((cursor) => tx.scanTasks({ conversationId: childId }, 256, cursor))
    const ids = await runIds(tx, childId, childTasks, childEntries)
    const runUsage = Array.from(ids, () => ({ ...ZERO_USAGE }))
    const childSummaries = await tx.doc(nativeSummaryUsage, childId)

    for (const value of Object.values(childSummaries.records)) {
      const run = ids.findIndex((id) => id === value.runId)

      if (run < 0) continue
      const total = runUsage[run]
      total.input += value.usage.input
      total.output += value.usage.output
      total.cacheRead += value.usage.cacheRead
      total.cacheWrite += value.usage.cacheWrite
      total.totalTokens += value.usage.totalTokens
      total.costUsd += value.usage.costUsd
    }

    for (const entry of childEntries) {
      if (entry.conversationId !== childId) continue

      if (!AssistantEntry.is(entry) && !CompactionEntry.is(entry)) continue
      const runId = entry.data.runId

      if (runId === undefined) continue
      const run = ids.indexOf(runId)

      if (run < 0) continue
      const summary = summaryUsage(entry)

      if (summary?.record.type === 'summary-usage') {
        const usage = runUsage[run]
        const value = summary.record.value.usage
        usage.input += value.input
        usage.output += value.output
        usage.cacheRead += value.cacheRead
        usage.cacheWrite += value.cacheWrite
        usage.totalTokens += value.totalTokens
        usage.costUsd += value.costUsd
      }

      for (const message of entry.model ?? []) {
        if (message.role !== 'assistant') continue
        const value = message.usage
        const usage = runUsage[run]
        usage.input += value.input
        usage.output += value.output
        usage.cacheRead += value.cacheRead
        usage.cacheWrite += value.cacheWrite
        usage.totalTokens += value.totalTokens
        usage.costUsd += value.cost.total
      }
    }

    children.set(child, {
      running: childLive.run !== undefined,
      runUsage,
      lastItem: runtimeId(String(childEntries.at(-1)!.id))
    })
  }

  const keysSeen = new Set(history.flatMap((entry) => ('key' in entry && entry.key ? [entry.key] : [])))

  for (const task of tasks) {
    if (task.conversationId !== id) continue
    const input = task.input
    if (typeof input !== 'object' || input === null || Array.isArray(input)) continue

    if (
      task.kind === 'cherry.behavior-job' &&
      task.state.status !== 'terminal' &&
      task.abortReason !== 'restart' &&
      !abandoned.has(task.id) &&
      typeof input.key === 'string' &&
      input.key
    )
      keysSeen.add(input.key)
  }

  const outcome = tasks
    .filter((task) => task.conversationId === id && task.kind === GenerationTask.definition.name)
    .at(-1)?.state.outcome

  const liveFacts: ConversationFacts['live'] = {
    idle: !live.run && inbox.items.length === 0,
    leftoverInputs: live.run ? 0 : inbox.items.filter((item) => item.mode !== 'write').length,
    queuedUserInput: inbox.items.some((item) => item.mode !== 'write' && !item.entry),
    hostCallInFlight: false
  }

  if (!live.run && outcome) {
    Object.assign(liveFacts, {
      runEnd: {
        outcome: outcome.status === 'aborted' ? 'aborted' : outcome.status === 'completed' ? 'completed' : 'error'
      }
    } satisfies Pick<ConversationFacts['live'], 'runEnd'>)
  }

  return {
    thread: threadId(id),
    lineage:
      record.owner && origin?.kind === 'record' && origin.record.type === 'subagent-origin'
        ? { kind: 'subagent', parent: threadId(record.owner.conversationId), origin: origin.record.value }
        : { kind: 'root' },
    history,
    children,
    keysSeen,
    live: liveFacts
  }
}

export const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 }

export function taskRun(task: TaskRecord<JsonValue, JsonValue, JsonValue>): TaskId {
  // SAFETY: Callers select SDK-owned generation records; runId is their optional native ID, while historical {} uses task.id.
  return (task.input as Pick<GenerationInput, 'runId'>).runId ?? task.id
}

export async function runIds(
  tx: Tx,
  id: ConversationId,
  tasks?: readonly TaskRecord<JsonValue, JsonValue, JsonValue>[],
  entries?: readonly EntryRecord[]
): Promise<(TaskId | undefined)[]> {
  tasks ??= await pages((cursor) => tx.scanTasks({ conversationId: id }, 256, cursor))
  entries ??= await lineageEntries(tx, id)
  const reservations = new Map<TaskId, number>()

  for (const entry of entries) {
    if (entry.conversationId !== id) continue
    const data = entry.data

    if (
      typeof data !== 'object' ||
      data === null ||
      Array.isArray(data) ||
      typeof data.key !== 'string' ||
      !data.key ||
      typeof data.cherryRun !== 'number' ||
      !Number.isSafeInteger(data.cherryRun) ||
      data.cherryRun < 1
    )
      continue
    const input = await tx.submissionByRequest(id, data.key)

    if (input?.type === 'input' && input.runId !== undefined && input.runId > input.id)
      reservations.set(input.runId, Math.max(reservations.get(input.runId) ?? 0, data.cherryRun))
  }

  const ids: (TaskId | undefined)[] = []

  for (const run of [
    ...new Set(tasks.filter((task) => task.kind === GenerationTask.definition.name).map(taskRun))
  ].sort((a, b) => a - b)) {
    const number = Math.max(ids.length + 1, reservations.get(run) ?? 0)

    while (ids.length < number - 1) ids.push(undefined)
    ids.push(run)
  }

  return ids
}
