import type { JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import { type ChildSpec, type Effect, type Step, type TurnInput, type TxOp, turnInput } from '../core/decisions'
import type { ConversationFacts, HistoryEntry, PolicyRecord, SubagentRunRecord, UsageFact } from '../core/facts'
import type { Key } from '../core/keys'
import type { ToolDefinition } from '../ports/harness'
import type { ContractHarness, ScriptedReply } from './harness'

export type Latch = { readonly promise: Promise<void>; release(): void }
export function latch(): Latch {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
export const aborted = (signal: AbortSignal): Promise<void> =>
  signal.aborted
    ? Promise.resolve()
    : new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))

export const toolBase = (name: string, replay: 'safe' | 'unsafe' = 'safe'): Omit<ToolDefinition, 'run'> => ({
  name,
  description: `Contract tool ${name}.`,
  schema: { type: 'object' },
  replay,
  executionMode: 'sequential',
  availability: 'all',
  modelOnly: true
})
export const echoTool = (): ToolDefinition => ({
  ...toolBase('echo'),
  async run(call) {
    return { text: JSON.stringify(call.args), isError: false }
  }
})

export type Holds = {
  readonly tool: ToolDefinition
  started(id: string): Promise<void>
  release(id: string): void
  invocations(id: string): number
}
/** A replay-safe `hold` tool: the call `{ id }` waits until the case releases that id or the call is aborted. */
export function holds(): Holds {
  const gates = new Map<string, Latch>()
  const starts = new Map<string, Latch>()
  const counts = new Map<string, number>()
  const at = (map: Map<string, Latch>, id: string): Latch => map.get(id) ?? map.set(id, latch()).get(id)!
  return {
    tool: {
      ...toolBase('hold'),
      async run(call) {
        const id = String((call.args as { readonly id?: JsonValue }).id)
        counts.set(id, (counts.get(id) ?? 0) + 1)
        at(starts, id).release()
        await Promise.race([at(gates, id).promise, aborted(call.signal)])
        return { text: `held ${id}`, isError: call.signal.aborted }
      }
    },
    started: (id) => at(starts, id).promise,
    release: (id) => at(gates, id).release(),
    invocations: (id) => counts.get(id) ?? 0
  }
}

export const key = (label: string): Key => `contract:${label}` as Key
export const notice = (text: string): PolicyRecord => ({ type: 'goal-notice', value: { text, level: 'info' } })
export const append = (thread: ThreadId, text: string, label: string): TxOp => ({
  type: 'append-record',
  thread,
  record: notice(text),
  key: key(label)
})
export const status = (text: string): TurnInput => turnInput({ type: 'subagent-status' }, text)
export const message = (text: string): TurnInput => turnInput({ type: 'subagent-message' }, text)
export const reply = (text: string, usage?: UsageFact): ScriptedReply => (usage ? { text, usage } : { text })
export const callTool = (name: string, args: JsonValue, usage?: UsageFact): ScriptedReply =>
  usage ? { text: '', toolCalls: [{ name, args }], usage } : { text: '', toolCalls: [{ name, args }] }
export const step = <R extends JsonValue>(
  ops: readonly TxOp[],
  result: R,
  effects: readonly Effect[] = []
): Step<R> => ({
  ops,
  effects,
  result
})
export const childSpec = (boundary: 'foreground' | 'background', description: string): ChildSpec => ({
  boundary,
  origin: { parentToolCallId: description, fork: false, description, modelKey: 'contract/model' },
  record: {
    parentToolCallId: description,
    description,
    fork: false,
    background: boundary === 'background',
    modelKey: 'contract/model',
    run: 1,
    status: 'running'
  }
})

export const read = (h: ContractHarness, thread: ThreadId): Promise<ConversationFacts> =>
  h.withCall(thread, (ports) => ports.ledger.read(thread))
export const transact = <R extends JsonValue>(
  h: ContractHarness,
  thread: ThreadId,
  decide: (facts: ConversationFacts) => Step<R>
) => h.withCall(thread, (ports) => ports.ledger.transact(thread, decide))
export async function spawnBackground(h: ContractHarness, parent: ThreadId, label: string): Promise<ThreadId> {
  const { spawned } = await transact(h, parent, () =>
    step([{ type: 'spawn-child', spec: childSpec('background', label), key: key(label) }], null)
  )
  return spawned[0].child
}

type ToolResultEntry = Extract<HistoryEntry, { kind: 'tool-result' }>
export const noticeTexts = (facts: ConversationFacts): string[] =>
  facts.history.flatMap((e) => (e.kind === 'record' && e.record.type === 'goal-notice' ? [e.record.value.text] : []))
export const markersWith = (facts: ConversationFacts, k: Key): HistoryEntry[] =>
  facts.history.filter((e) => e.kind === 'marker' && e.key === k)
export const assistantTexts = (facts: ConversationFacts): string[] =>
  facts.history.flatMap((e) => (e.kind === 'assistant' ? [e.text] : []))
export const toolResults = (facts: ConversationFacts): ToolResultEntry[] =>
  facts.history.filter((e): e is ToolResultEntry => e.kind === 'tool-result')
export const userCount = (facts: ConversationFacts): number => facts.history.filter((e) => e.kind === 'user').length
export const runRecordOf = (facts: ConversationFacts, k: Key): SubagentRunRecord | undefined =>
  facts.history.flatMap((e) =>
    e.kind === 'record' && e.key === k && e.record.type === 'subagent-run' ? [e.record.value] : []
  )[0]
