import type { ItemId, JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { Step } from '../../src/core/decisions'
import { decodeEntry } from '../../src/core/entryCodec'
import {
  callKeyOf,
  type ChildFacts,
  type ConversationFacts,
  type GoalCleared,
  type GoalSnapshot,
  type HistoryEntry,
  type LiveFacts,
  type MarkerFact,
  type PolicyRecord,
  type RoundDetails,
  type SubagentRunRecord,
  type ToolCallFact,
  type UsageFact
} from '../../src/core/facts'
import type { CallInputs, HostSettingsSnapshot, ModelFacts } from '../../src/core/hostFacts'

let items = 0
const item = (): ItemId => `item-${++items}` as ItemId
export const thread = (id: string) => id as ThreadId
export const PARENT = thread('parent')
export const call = (id: string) => callKeyOf(id)

export const usage = (tokens: number, costUsd = 0): UsageFact => ({
  input: tokens,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: tokens,
  costUsd
})
export const user = (text = ''): HistoryEntry => ({ kind: 'user', id: item(), text })
export const assistant = (
  text: string,
  options: {
    calls?: readonly ToolCallFact[]
    usage?: UsageFact
    stop?: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'
    error?: string
  } = {}
): HistoryEntry => ({
  kind: 'assistant',
  id: item(),
  text,
  toolCalls: options.calls ?? [],
  usage: options.usage ?? usage(0),
  stop: options.stop ?? 'stop',
  ...(options.error === undefined ? {} : { error: options.error })
})
/** A call whose `CallKey` is `key:<callId>`, the same key `result` derives for its `callId`. */
export const callTo = (name: string, args: JsonValue = {}, callId = `c${++items}`): ToolCallFact => ({
  callId,
  callKey: callKeyOf(`key:${callId}`),
  name,
  args
})
export const result = (
  tool: string,
  options: { isError?: boolean; details?: JsonValue; text?: string; callId?: string } = {}
): HistoryEntry => ({
  kind: 'tool-result',
  id: item(),
  callId: options.callId ?? 'c',
  callKey: callKeyOf(`key:${options.callId ?? 'c'}`),
  tool,
  isError: options.isError ?? false,
  ...(options.details === undefined ? {} : { details: options.details }),
  text: options.text ?? ''
})
export const record = (value: PolicyRecord, key?: string): HistoryEntry => ({
  kind: 'record',
  id: item(),
  ...(key === undefined ? {} : { key }),
  record: value
})
export const marker = (value: MarkerFact, key?: string, text = ''): HistoryEntry => ({
  kind: 'marker',
  id: item(),
  ...(key === undefined ? {} : { key }),
  marker: value,
  text
})
export const goalEntry = (value: GoalSnapshot | GoalCleared) => record({ type: 'goal', value })
export const roundEntry = (round: RoundDetails) => marker({ type: 'goal-round', round }, round.id)
export const compaction = (): HistoryEntry => ({ kind: 'compaction', id: item() })

export const goal = (patch: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  id: 'g1',
  revision: 1,
  objective: 'ship it',
  phase: 'active',
  roundsStarted: 0,
  progressRounds: 0,
  maxGoalRounds: 20,
  tokensUsed: 0,
  costUsed: 0,
  wrapUpDone: false,
  armed: true,
  createdAt: 0,
  updatedAt: 0,
  ...patch
})
export const run = (child: string, patch: Partial<SubagentRunRecord> = {}): SubagentRunRecord => ({
  sessionId: thread(child),
  parentToolCallId: `call-${child}`,
  description: `task ${child}`,
  fork: false,
  background: true,
  modelKey: 'p/m',
  run: 1,
  status: 'running',
  ...patch
})
export const runEntry = (value: SubagentRunRecord, key?: string) => record({ type: 'subagent-run', value }, key)

export const SETTINGS: HostSettingsSnapshot = {
  goalDefaults: { maxGoalRounds: 20, maxGoalRoundsCeiling: 100, blockedAfter: 3 },
  autonomy: 'auto',
  permissionMode: 'default',
  attendance: 'stream',
  maxBackground: 20,
  offloadThreshold: 20_000
}
export const MODELS: ModelFacts = {
  candidates: [],
  parentModelKey: 'p/parent',
  defaultChildModelKey: 'p/child',
  supportsTools: true
}
export const inputs = (patch: Partial<CallInputs> = {}): CallInputs => ({
  now: 1000,
  settings: SETTINGS,
  approvals: [],
  models: MODELS,
  ...patch
})
export const turnStop = (cause: 'user' | 'goal-command' | 'reopen' = 'user') =>
  record({ type: 'turn-stop', value: { cause, at: 1 } })

export type FactsOptions = {
  live?: Partial<LiveFacts>
  children?: Record<string, Partial<ChildFacts>>
  lineage?: ConversationFacts['lineage']
  jobs?: readonly string[]
}
/** Facts as an adapter delivers them; `keysSeen` is every entry key plus `jobs`. */
export function facts(history: readonly HistoryEntry[], options: FactsOptions = {}): ConversationFacts {
  const children = new Map<ThreadId, ChildFacts>()
  for (const [id, child] of Object.entries(options.children ?? {}))
    children.set(thread(id), {
      running: false,
      runUsage: [],
      lastItem: `${id}-last` as ItemId,
      ...child
    })
  const keysSeen = new Set<string>(options.jobs)
  for (const entry of history)
    if ((entry.kind === 'record' || entry.kind === 'marker') && entry.key) keysSeen.add(entry.key)
  return {
    thread: PARENT,
    lineage: options.lineage ?? { kind: 'root' },
    history,
    live: {
      idle: true,
      leftoverInputs: 0,
      queuedUserInput: false,
      hostCallInFlight: false,
      pendingLaunches: 0,
      ...options.live
    },
    children,
    keysSeen
  }
}

/**
 * Applies a step's operations the way a harness commits them, dropping keys already seen (design §7.2); spawned
 * children get the ids in `children`, in order. Effects are not applied: tests start turns explicitly.
 */
export function apply(history: readonly HistoryEntry[], step: Step, children: readonly string[] = []): HistoryEntry[] {
  const seen = new Set(facts(history).keysSeen)
  const next = [...history]
  let spawned = 0
  for (const op of step.ops) {
    if (seen.has(op.key)) continue
    seen.add(op.key)
    if (op.type === 'append-record') next.push(record(op.record, op.key))
    if (op.type === 'append-quiet') next.push(inputEntry(op.input, op.key))
    if (op.type === 'spawn-child')
      next.push(runEntry({ ...op.spec.record, sessionId: thread(children[spawned++] ?? 'child') }, op.key))
  }
  return next
}
/** The marker entry a started turn input becomes. */
export function inputEntry(
  input: { readonly kind: string; readonly text: string; readonly data: JsonValue },
  key: string
): HistoryEntry {
  const data = { ...(input.data as { readonly [field: string]: JsonValue }), key }
  const entry = decodeEntry({ id: item(), kind: input.kind, data, text: input.text })
  if (!entry) throw new Error(`not a marker input: ${input.kind}`)
  return entry
}
