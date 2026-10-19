import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { SessionManager } from '@earendil-works/pi-coding-agent'

import type {
  BoundPorts,
  ContextFilterHandler,
  ConversationFacts,
  GateHandlers,
  GatePorts,
  JobHandler,
  JobKind,
  JobSpec,
  Key,
  LifecycleHandlers,
  MessageResult,
  RequestMeterHandler,
  RunEndFacts,
  StartResult,
  ToolCallFact,
  ToolDefinition,
  TurnInput,
  UsageFact
} from '@cherrystudio/agent-behavior'
import type { JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { AgentRuntimeSession } from '../session'

/** The parent run whose tool call spawned a foreground child; stopping that run stops the child. */
export type Owner = { readonly thread: ThreadId; readonly run: number }
/** How a run ended: what the conversation reports as `live.runEnd`, and what `awaitAnswer` answers. */
export type RunEnding = { readonly live: 'completed' | 'error' | 'aborted'; readonly answer: RunEndFacts }
export type Submission = {
  /** A person's text, or the turn input of a key. */
  readonly input: TurnInput | string
  readonly admission: StartResult | MessageResult
  state: 'queued' | 'running' | 'settled' | 'withdrawn'
  /** The run that took it. */
  run?: number
}
/** One run: from the input that starts it to Pi's `agent_settled`. */
export type RunState = {
  readonly run: number
  /** Kind of the input that started the run; `undefined` for a person's text. */
  readonly startedBy: string | undefined
  /** Pi has not entered the run yet. */
  pending: boolean
  stopRequested: boolean
  /** Model requests the run made, for the request meter. */
  requests: number
  /** The request meter's refusal that ended the run. */
  refused?: string
  /** The run's calls in call order, for the gate's goal-round window. */
  readonly window: ToolCallFact[]
  lastReply?: AssistantMessage
  readonly done: Promise<void>
  readonly end: () => void
}
/** One conversation in this process: its native session plus what Pi does not keep (admissions, run ends, usage). */
export type Conversation = {
  readonly thread: ThreadId
  readonly manager: SessionManager
  readonly lineage: ConversationFacts['lineage']
  readonly owner?: Owner
  readonly reopened: boolean
  native?: AgentRuntimeSession
  readonly submissions: Map<string, Submission>
  /** Keys waiting for a run of their own. */
  readonly inbox: string[]
  /** Messages for the active run that Pi could not take yet. */
  readonly held: string[]
  /** Messages in Pi's steering queue that Pi has not placed yet. */
  readonly steered: Set<string>
  active?: RunState
  runs: number
  readonly ends: Map<number, RunEnding>
  lastEnd?: RunEnding['live']
  /** Index `i` is run `i + 1`. */
  readonly runUsage: UsageFact[]
  readonly waiters: (() => boolean)[]
  /** Host compactions accepted and not yet returned (G6: a host call in flight). */
  hostCompacts: number
  /** `onCompacted` of the latest compaction and the drain after it. */
  compacted: Promise<void>
}
export type JobRecord = {
  readonly key: Key
  readonly spec: JobSpec
  /** The thread whose transaction ensured the job; its `keysSeen` holds the key while the job lives. */
  readonly thread: ThreadId
  state: 'live' | 'done' | 'failed'
}
/** What `install` registered. */
export type Installation = {
  readonly tools: Map<string, ToolDefinition>
  readonly jobs: Map<JobKind, JobHandler>
  gate?: GateHandlers
  filter?: ContextFilterHandler
  meter?: RequestMeterHandler
  lifecycle?: LifecycleHandlers
}
/** What the port modules share with the harness that owns them. */
export interface Adapter {
  readonly conversations: Map<ThreadId, Conversation>
  readonly jobs: Map<string, JobRecord>
  readonly installation: Installation
  readonly gatePorts: GatePorts
  conversation(thread: ThreadId): Conversation
  /** Counts `work` as pending for `settled()` until it settles. */
  track<T>(work: Promise<T>): Promise<T>
  report(error: unknown): void
  withScope<T>(owner: Owner | undefined, use: (ports: BoundPorts) => Promise<T>): Promise<T>
  lifecycle(call: (handlers: LifecycleHandlers, ports: BoundPorts) => Promise<void>): Promise<void>
}

export function newConversation(
  thread: ThreadId,
  manager: SessionManager,
  lineage: ConversationFacts['lineage'],
  owner: Owner | undefined,
  reopened: boolean
): Conversation {
  return {
    thread,
    manager,
    lineage,
    ...(owner && { owner }),
    reopened,
    submissions: new Map(),
    inbox: [],
    held: [],
    steered: new Set(),
    runs: 0,
    ends: new Map(),
    runUsage: [],
    waiters: [],
    hostCompacts: 0,
    compacted: Promise.resolve()
  }
}

const isFields = (value: JsonValue): value is { readonly [field: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A turn input as the custom message Pi stores and the model reads: its kind, text, and data with the key merged in. */
export const markerMessage = (input: TurnInput, key: string) => ({
  customType: input.kind,
  content: input.text,
  display: false,
  details: { ...(isFields(input.data) ? input.data : {}), key }
})

/** Pi runs nothing and compacts nothing on this conversation. */
export const piIdle = (conv: Conversation): boolean => conv.native !== undefined && conv.native.session.isIdle
/** `LiveFacts.idle`: no run, nothing queued, Pi idle. */
export const isIdle = (conv: Conversation): boolean =>
  conv.active === undefined && conv.inbox.length === 0 && piIdle(conv)

export function waitFor(conv: Conversation, ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve()
  return new Promise((resolve) => {
    conv.waiters.push(() => {
      if (!ready()) return false
      resolve()
      return true
    })
  })
}

/** Re-checks the conversation's waiters after a change to its runs or queued input. */
export function wake(conv: Conversation): void {
  const waiting = conv.waiters.splice(0)
  conv.waiters.push(...waiting.filter((waiter) => !waiter()))
}
