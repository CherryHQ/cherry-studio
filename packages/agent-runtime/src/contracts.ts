import type { DynamicToolUIPart, UIMessage } from 'ai'

declare const identity: unique symbol
export type RuntimeId<K extends string> = string & { readonly [identity]: K }
export type BackendId = RuntimeId<'backend'>
export type ThreadId = RuntimeId<'thread'>
export type InputId = RuntimeId<'input'>
export type ItemId = RuntimeId<'item'>
export type SubagentId = RuntimeId<'subagent'>
export type NativeInputId = RuntimeId<'native-input'>

/** Restore an opaque ID at a validated storage or transport boundary. */
export function runtimeId<K extends string>(value: string): RuntimeId<K> {
  if (!value.trim()) throw new TypeError('Runtime IDs must not be empty')
  return value as RuntimeId<K>
}

export interface Thread {
  readonly backendId: BackendId
  readonly id: ThreadId
}
export interface ItemRef {
  readonly session: Thread
  readonly id: ItemId
}
export interface NativeInputRef {
  readonly session: Thread
  readonly id: NativeInputId
}
export interface InputDraft {
  readonly inputId: InputId
  readonly text: string
}
export interface RuntimeError {
  readonly operation: string
  readonly code: string
  readonly message: string
}
export type OperationResult<T> =
  | { readonly status: 'confirmed'; readonly value: T }
  | { readonly status: 'rejected' | 'unsupported' | 'unknown'; readonly error: RuntimeError }
export type InputFact = 'accepted' | 'queued' | 'dispatch-started' | 'locally-handled' | 'placed'
export type SubmitResult =
  | {
      readonly status: 'acknowledged'
      readonly inputId: InputId
      readonly nativeInput?: NativeInputRef
      readonly facts: readonly InputFact[]
    }
  | { readonly status: 'rejected'; readonly inputId: InputId; readonly error: RuntimeError }
  | { readonly status: 'unsupported'; readonly inputId: InputId; readonly error: RuntimeError }
  | { readonly status: 'unknown'; readonly inputId: InputId; readonly error: RuntimeError }
export type InputState = (
  | { readonly inputId: InputId; readonly nativeInput?: NativeInputRef }
  | { readonly inputId?: InputId; readonly nativeInput: NativeInputRef }
) & {
  readonly facts: readonly InputFact[]
  readonly outcome?: 'completed' | 'failed' | 'aborted' | 'unanswered'
  readonly error?: RuntimeError
}
export type ProductInputState = Extract<InputState, { readonly inputId: InputId }>
export function hasProductInputId(input: InputState): input is ProductInputState {
  return input.inputId !== undefined
}
export type LookupInput = (
  thread: Thread,
  inputId: InputId,
  legacyId?: NativeInputId
) => Promise<ProductInputState | undefined>
export type InputLookup = { readonly found: false } | { readonly found: true; readonly input: ProductInputState }
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type Completeness = 'partial' | 'complete' | 'unknown'
/** One native conversation message; tools and their results remain in its ordered parts. */
/** Observation result payloads are immutable snapshots; delivery containers are isolated per observer. */
export type RuntimeMessage = UIMessage<{
  completeness: Completeness
  inputId?: InputId
  error?: RuntimeError
}>
export interface Subagent {
  /** Stable within the parent's observed relationships, across child inputs and runs. */
  readonly id: SubagentId
  readonly parent: Thread
  readonly child?: Thread
  /** Evidenced creation call, scoped to parent; continuation does not replace it. */
  readonly origin?: { readonly toolCallId: string; readonly description?: string }
}
export interface Activity {
  readonly state: 'active' | 'idle' | 'unknown'
  readonly modelRetry?: { readonly modelId: string; readonly attempt: number; readonly reason: string }
}
export type ContextCategoryKey =
  | 'messages'
  | 'system-prompt'
  | 'system-tools'
  | 'mcp-tools'
  | 'mcp-instructions'
  | 'memory-files'
  | 'skills'
  | 'agents'
  | 'other'
export interface ContextTokenCount {
  readonly tokens: number
  readonly precision: 'reported' | 'estimated'
}
export interface ContextCategory extends ContextTokenCount {
  readonly id: string
  readonly key: ContextCategoryKey
  readonly label?: string
  readonly occupancy: 'included' | 'deferred'
}
export interface ContextResource {
  readonly id: string
  readonly category: ContextCategoryKey
  readonly name: string
  readonly source?: string
  readonly count?: ContextTokenCount
  readonly state?: 'loaded' | 'deferred'
}
export interface ThreadContextUsage {
  readonly model: string
  readonly revision: string
  readonly contextWindow?: number
  readonly used?: ContextTokenCount
  readonly basis: 'current-context' | 'last-request'
  readonly reserved?: ContextTokenCount
  readonly free?: ContextTokenCount
  readonly breakdown?: { readonly coverage: 'partial' | 'complete'; readonly categories: readonly ContextCategory[] }
  readonly resources?: readonly ContextResource[]
}
export interface ThreadSnapshot {
  readonly type: 'snapshot'
  readonly contextUsage?: OperationResult<ThreadContextUsage>
  readonly messages: readonly RuntimeMessage[]
  readonly inputs: readonly InputState[]
  readonly subagents?: readonly Subagent[]
  readonly activity: Activity
}

export type NativePartUpdate = {
  readonly ref: ItemRef
  readonly part: number
  readonly message?: never
  readonly parts?: never
  readonly value?: never
} & (
  | {
      readonly type: 'message.text-open'
      readonly kind: 'text' | 'reasoning'
      readonly providerMetadata?: RuntimeText['providerMetadata']
      readonly text?: never
      readonly tool?: never
    }
  | { readonly type: 'message.text-append'; readonly text: string; readonly tool?: never }
  | {
      readonly type: 'message.text-finish'
      readonly providerMetadata?: RuntimeText['providerMetadata']
      readonly text?: never
      readonly tool?: never
    }
  | {
      readonly type: 'message.tool-output'
      readonly text?: never
      readonly tool: Extract<DynamicToolUIPart, { state: 'output-available' | 'output-error' }>
    }
)

export type RuntimePart = RuntimeMessage['parts'][number]
type RuntimeText = Extract<RuntimePart, { type: 'text' | 'reasoning' }>

export type RuntimePartEdit = { readonly part: number } & (
  | {
      readonly type: 'open'
      readonly kind: RuntimeText['type']
      readonly providerMetadata?: RuntimeText['providerMetadata']
      readonly text?: never
      readonly value?: never
    }
  | { readonly type: 'append'; readonly text: string; readonly value?: never }
  | {
      readonly type: 'finish'
      readonly providerMetadata?: RuntimeText['providerMetadata']
      readonly text?: never
      readonly value?: never
    }
  | ({ readonly type: 'correct'; readonly value?: never; readonly kind: RuntimeText['type'] } & Pick<
      RuntimeText,
      'text' | 'state' | 'providerMetadata'
    >)
  | { readonly type: 'put'; readonly value: Exclude<RuntimePart, RuntimeText>; readonly text?: never }
)

export type MessageObservation =
  | { readonly type: 'message.parts'; readonly ref: ItemRef; readonly changes: readonly RuntimePartEdit[] }
  | { readonly type: 'message.reconcile'; readonly message: RuntimeMessage; readonly replaces?: readonly ItemRef[] }

export type ObservationPayload =
  | ThreadSnapshot
  | { readonly type: 'context.changed'; readonly result: OperationResult<ThreadContextUsage> }
  | MessageObservation
  | NativePartUpdate
  | { readonly type: 'message.remove'; readonly ref: ItemRef }
  | { readonly type: 'input.changed'; readonly input: InputState }
  | { readonly type: 'activity.changed'; readonly activity: Activity }
  | { readonly type: 'subagent.upsert'; readonly subagent: Subagent }
  | { readonly type: 'diagnostic'; readonly error: RuntimeError }
  | { readonly type: 'gap'; readonly reason: 'overflow' | 'disconnected' | 'mapping-reset' }
  | { readonly type: 'closed'; readonly reason: 'stopped' | 'released' | 'shutdown' | 'source-lost' | 'consumer-error' }
export type ObservationSink = (event: ObservationPayload) => void | Promise<void>
/** A live part batch preserves operation order. A reconciliation batch can install or retire sources. */
export type LivePartInput = NativePartUpdate | Extract<MessageObservation, { type: 'message.parts' }>
export type ProjectionEvents = readonly LivePartInput[] | readonly Exclude<ObservationPayload, LivePartInput>[]

export function isLivePartInput(event: ObservationPayload): event is LivePartInput {
  return 'part' in event || event.type === 'message.parts'
}

export function isPartBatch(events: ProjectionEvents): events is readonly LivePartInput[] {
  return events.length > 0 && isLivePartInput(events[0])
}
export interface Observation {
  /** Join callbacks through facts published before this call; rejects if delivery was discarded. */
  drain(): Promise<void>
  stop(): Promise<void>
}
export type SubmitInput<D extends { readonly inputId: InputId } = InputDraft> = (
  input: D & { readonly whenBusy?: never }
) => Promise<SubmitResult>
export interface ThreadInput<D extends { readonly inputId: InputId } = InputDraft> {
  readonly submit?: SubmitInput<D>
  readonly steer?: { readonly whenIdle: 'reject' | 'may-start'; readonly submit: SubmitInput<D> }
  readonly followUp?: { readonly persistence: 'durable' | 'volatile' | 'unknown'; readonly submit: SubmitInput<D> }
}
export type CompactThread = (instructions?: string) => Promise<OperationResult<void>>

export interface ThreadHandle {
  readonly thread: Thread
  contextUsage(): Promise<OperationResult<ThreadContextUsage>>
  readonly input?: ThreadInput
  readonly compact?: CompactThread
  observe(sink: ObservationSink): Promise<OperationResult<Observation>>
  interrupt?: () => Promise<OperationResult<void>>
  release(): Promise<void>
}
export interface AgentRuntime {
  open(ref: Thread): Promise<OperationResult<ThreadHandle>>
  shutdown(): Promise<OperationResult<void>>
}
export interface RuntimeEffortControl<Value extends string = string> {
  id: string
  currentValue: Value
  application: 'session' | 'next-turn'
  modelId?: string
  options: Array<{ value: Value; name: string; description?: string }>
}

export interface RuntimeModelOption {
  id: string
  name: string
  description?: string
  _meta?: Record<string, unknown>
  effort?: {
    options: RuntimeEffortControl['options']
    defaultValue?: string
  }
}
