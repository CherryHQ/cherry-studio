import {
  InboxDoc,
  LiveDoc,
  type ConversationId,
  type Cursor,
  type EntryRecord,
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
import { runtimeId, type JsonValue, type ThreadId } from '@cherrystudio/agent-runtime'

export const threadId = (id: ConversationId): ThreadId => runtimeId(String(id))
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

export async function lineageEntries(tx: Tx, id: ConversationId): Promise<EntryRecord[]> {
  return pages((cursor) => tx.scanEntries({ conversationId: id, order: 'ascending' }, 256, cursor))
}

export function historyOf(
  entries: readonly EntryRecord[],
  tasks: readonly TaskRecord<JsonValue, JsonValue, JsonValue>[]
): HistoryEntry[] {
  const calls = new Map<string, string>()
  for (const task of tasks) {
    const input = task.input as { kind?: string; assistant?: number; callId?: string }
    if (task.kind === 'pi.tool' && input.kind === 'model')
      calls.set(`${input.assistant}:${input.callId}`, String(task.id))
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
    if (decoded) return [decoded]
    if (entry.kind === 'pi.compaction') return [{ kind: 'compaction', id }]
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
  abandoned: ReadonlySet<TaskId> = new Set()
): Promise<ConversationFacts> {
  const entries = await lineageEntries(tx, id)
  const tasks = (
    await Promise.all(
      [...new Set([id, ...entries.map((entry) => entry.conversationId)])].map((conversationId) =>
        pages((cursor) => tx.scanTasks({ conversationId }, 256, cursor))
      )
    )
  ).flat()
  const history = historyOf(entries, tasks)
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
    for (const entry of childEntries) {
      if (entry.conversationId !== childId) continue
      const runId = (entry.data as { runId?: TaskId })?.runId
      if (runId === undefined) continue
      const run = ids.indexOf(runId)
      if (run < 0) continue
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
    const input = task.input as { key?: string }
    if (
      task.kind === 'cherry.behavior-job' &&
      task.state.status !== 'terminal' &&
      task.abortReason !== 'restart' &&
      !abandoned.has(task.id) &&
      input.key
    )
      keysSeen.add(input.key)
  }
  const outcome = tasks.filter((task) => task.conversationId === id && task.kind === 'pi.generation').at(-1)
    ?.state.outcome
  return {
    thread: threadId(id),
    lineage:
      record.owner && origin?.kind === 'record' && origin.record.type === 'subagent-origin'
        ? { kind: 'subagent', parent: threadId(record.owner.conversationId), origin: origin.record.value }
        : { kind: 'root' },
    history,
    children,
    keysSeen,
    live: {
      idle: !live.run && inbox.items.length === 0,
      leftoverInputs: live.run ? 0 : inbox.items.filter((item) => item.mode !== 'write').length,
      queuedUserInput: inbox.items.some((item) => item.mode !== 'write' && !item.entry),
      hostCallInFlight: false,
      pendingLaunches: 0,
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

export const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 }
export function taskRun(task: TaskRecord<JsonValue, JsonValue, JsonValue>): TaskId {
  return (task.input as { runId?: TaskId }).runId ?? task.id
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
    const data = entry.data as { key?: string; cherryRun?: number } | undefined
    if (!data?.key || data.cherryRun === undefined) continue
    const input = await tx.submissionByRequest(id, data.key)
    if (input?.type === 'input' && input.runId !== undefined && input.runId > input.id)
      reservations.set(input.runId, Math.max(reservations.get(input.runId) ?? 0, data.cherryRun))
  }
  const ids: (TaskId | undefined)[] = []
  for (const run of [...new Set(tasks.filter((task) => task.kind === 'pi.generation').map(taskRun))].sort(
    (a, b) => a - b
  )) {
    const number = Math.max(ids.length + 1, reservations.get(run) ?? 0)
    while (ids.length < number - 1) ids.push(undefined)
    ids.push(run)
  }
  return ids
}
