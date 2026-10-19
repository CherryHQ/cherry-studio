import type { TextContent, Usage } from '@earendil-works/pi-ai'
import type { buildSessionContext, SessionEntry } from '@earendil-works/pi-coding-agent'

import {
  type CallKey,
  callKeyOf,
  decodeEntry,
  type HistoryEntry,
  type PlanState,
  type ToolCallFact,
  type UsageFact
} from '@cherrystudio/agent-behavior'
import { type ItemId, type JsonValue, runtimeId, type ThreadId } from '@cherrystudio/agent-runtime'

/** A message of the context Pi builds from the branch. */
export type ContextMessage = ReturnType<typeof buildSessionContext>['messages'][number]
type AssistantStop = Extract<HistoryEntry, { kind: 'assistant' }>['stop']

/** How a blocked call's result reads, as Durable stores it; the projection reads it back as `blocked`. */
export const BLOCKED_PREFIX = 'Tool call blocked: '
export const ZERO_USAGE: UsageFact = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 }
const STOPS: ReadonlySet<string> = new Set<AssistantStop>(['stop', 'length', 'toolUse', 'error', 'aborted'])

/** H9 @keys: coding-agent's call key is `<sessionId>:<toolCallId>`; history, the gate and approvals share it. */
export const callKeyFor = (thread: ThreadId, toolCallId: string): CallKey => callKeyOf(`${thread}:${toolCallId}`)

export const usageFact = (usage: Usage): UsageFact => ({
  input: usage.input,
  output: usage.output,
  cacheRead: usage.cacheRead,
  cacheWrite: usage.cacheWrite,
  totalTokens: usage.totalTokens,
  costUsd: usage.cost.total
})

export const addUsage = (a: UsageFact, b: UsageFact): UsageFact => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  totalTokens: a.totalTokens + b.totalTokens,
  costUsd: a.costUsd + b.costUsd
})

export function textOf(content: string | readonly { readonly type: string }[]): string {
  if (typeof content === 'string') return content
  return content.map((part) => (part.type === 'text' ? (part as TextContent).text : '')).join('')
}

/** The `key` a marker's details or a record's data carries. */
export function keyOf(details: unknown): string | undefined {
  const key = typeof details === 'object' && details !== null ? (details as { readonly key?: unknown }).key : undefined
  return typeof key === 'string' ? key : undefined
}

/** `thread`'s branch as the package's history (agent-behavior README "History projection"); other Pi entries are left out. */
export function historyOf(entries: readonly SessionEntry[], thread: ThreadId): HistoryEntry[] {
  return entries.flatMap((entry) => projectEntry(entry, thread) ?? [])
}

function projectEntry(entry: SessionEntry, thread: ThreadId): HistoryEntry | undefined {
  const id = runtimeId<'item'>(entry.id)
  switch (entry.type) {
    case 'custom':
      return decodeEntry({ id, kind: entry.customType, data: entry.data as JsonValue | undefined })
    // A marker keeps its data in `details`; `content` is the text the model reads.
    case 'custom_message':
      return decodeEntry({
        id,
        kind: entry.customType,
        data: entry.details as JsonValue | undefined,
        text: textOf(entry.content)
      })
    case 'compaction':
      return { kind: 'compaction', id }
    case 'message':
      return projectMessage(id, entry.message, thread)
    default:
      return undefined
  }
}

function projectMessage(id: ItemId, message: ContextMessage, thread: ThreadId): HistoryEntry | undefined {
  switch (message.role) {
    case 'user':
      return { kind: 'user', id, text: textOf(message.content) }
    case 'assistant': {
      if (!STOPS.has(message.stopReason)) return undefined
      const toolCalls = message.content.flatMap((part): ToolCallFact[] =>
        part.type === 'toolCall'
          ? [{ callId: part.id, callKey: callKeyFor(thread, part.id), name: part.name, args: part.arguments }]
          : []
      )
      const reply = {
        kind: 'assistant' as const,
        id,
        text: textOf(message.content),
        toolCalls,
        usage: usageFact(message.usage),
        stop: message.stopReason as AssistantStop
      }
      return message.errorMessage === undefined ? reply : { ...reply, error: message.errorMessage }
    }
    case 'toolResult': {
      const text = textOf(message.content)
      const blocked = message.isError && text.startsWith(BLOCKED_PREFIX) ? text.slice(BLOCKED_PREFIX.length) : undefined
      return {
        kind: 'tool-result',
        id,
        callId: message.toolCallId,
        callKey: callKeyFor(thread, message.toolCallId),
        tool: message.toolName,
        isError: message.isError,
        text,
        ...(message.details === undefined ? {} : { details: message.details }),
        ...(blocked === undefined ? {} : { blocked })
      }
    }
    default:
      return undefined
  }
}

/** Keys the thread's records and markers carry (`ConversationFacts.keysSeen` without live jobs). */
export function keysOf(history: readonly HistoryEntry[]): Set<string> {
  const keys = new Set<string>()
  for (const entry of history)
    if ((entry.kind === 'record' || entry.kind === 'marker') && entry.key !== undefined) keys.add(entry.key)
  return keys
}

/** The latest `plan` record (`GateFacts.plan`). */
export function latestPlan(history: readonly HistoryEntry[]): PlanState | undefined {
  let plan: PlanState | undefined
  for (const entry of history) if (entry.kind === 'record' && entry.record.type === 'plan') plan = entry.record.value
  return plan
}

const markerId = (kind: string, key: string): string => `${kind}\u0000${key}`

/**
 * The markers `ids` names, as kind and key: Pi's request messages carry no entry ids (H10). A marker without a key
 * cannot be told apart in a request, so it cannot be omitted.
 */
export function omittedMarkers(entries: readonly SessionEntry[], ids: readonly ItemId[]): Set<string> {
  const wanted = new Set<string>(ids)
  const omitted = new Set<string>()
  for (const entry of entries) {
    if (entry.type !== 'custom_message' || !wanted.has(entry.id)) continue
    const key = keyOf(entry.details)
    if (key !== undefined) omitted.add(markerId(entry.customType, key))
  }
  return omitted
}

export function withoutMarkers(messages: ContextMessage[], omitted: ReadonlySet<string>): ContextMessage[] {
  if (omitted.size === 0) return messages
  return messages.filter(
    (message) => message.role !== 'custom' || !omitted.has(markerId(message.customType, keyOf(message.details) ?? ''))
  )
}
