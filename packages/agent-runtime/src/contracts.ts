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
export type BusyPolicy = 'reject' | 'steer' | 'follow-up'
export interface InputDraft {
  readonly inputId: InputId
  readonly text: string
  readonly whenBusy: BusyPolicy
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
  | { readonly status: 'rejected' | 'unsupported' | 'unknown'; readonly inputId: InputId; readonly error: RuntimeError }
export type InputState = (
  | { readonly inputId: InputId; readonly nativeInput?: NativeInputRef }
  | { readonly inputId?: InputId; readonly nativeInput: NativeInputRef }
) & {
  readonly facts: readonly InputFact[]
  readonly outcome?: 'completed' | 'failed' | 'aborted' | 'unanswered'
  /** Evidenced terminal response, which may be shared by several inputs or contain a failure. */
  readonly response?: ItemRef
  readonly error?: RuntimeError
}
export type InputQuery =
  | { readonly by: 'native-ref'; readonly ref: NativeInputRef }
  | { readonly by: 'deduplication-key'; readonly key: string }
export type InputLookup = { readonly found: false } | { readonly found: true; readonly input: InputState }
export interface RetractionReceipt {
  readonly effect: 'withdrawn' | 'already-placed' | 'already-settled'
}
export interface InterruptReceipt {
  readonly effect: 'requested' | 'native-scope-idle'
}
export interface ResumeReceipt {
  readonly scope: 'runtime'
  readonly effect: 'scheduling-enabled'
}
export interface ShutdownReceipt {
  readonly effect: 'closed'
}
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export interface ContentPart {
  readonly type: 'text' | 'reasoning'
  readonly text: string
}
export type Completeness = 'partial' | 'complete' | 'unknown'
export interface MessageItem {
  readonly ref: ItemRef
  readonly type: 'message'
  readonly role: 'user' | 'assistant' | 'system'
  readonly parts: readonly ContentPart[]
  readonly completeness: Completeness
  readonly inputId?: InputId
}
export interface ToolCallItem {
  readonly ref: ItemRef
  readonly type: 'tool-call'
  readonly name: string
  readonly argumentsText: string
  readonly completeness: Completeness
}
export interface ToolResultItem {
  readonly ref: ItemRef
  readonly type: 'tool-result'
  readonly call?: ItemRef
  readonly parts: readonly ContentPart[]
  readonly data?: JsonValue
  readonly outcome: 'success' | 'error' | 'unknown'
}
export type ContentItem = MessageItem | ToolCallItem | ToolResultItem
export interface Subagent {
  /** Stable within the parent's observed relationships, across child inputs and runs. */
  readonly id: SubagentId
  readonly parent: Thread
  readonly child?: Thread
}
export interface Activity {
  readonly scope: 'foreground'
  readonly state: 'active' | 'idle' | 'unknown'
}
export interface ThreadSnapshot {
  readonly type: 'snapshot'
  readonly coverage: 'live-only' | 'current-view' | 'retained-view'
  readonly items: readonly ContentItem[]
  readonly inputs: readonly InputState[]
  readonly subagents?: readonly Subagent[]
  readonly activity: Activity
}
export type ObservationPayload =
  | ThreadSnapshot
  | { readonly type: 'item.upsert'; readonly item: ContentItem; readonly replaces?: readonly ItemRef[] }
  | { readonly type: 'item.remove'; readonly ref: ItemRef }
  | { readonly type: 'input.changed'; readonly input: InputState }
  | { readonly type: 'activity.changed'; readonly activity: Activity }
  | { readonly type: 'subagent.upsert'; readonly subagent: Subagent }
  | { readonly type: 'diagnostic'; readonly error: RuntimeError }
  | { readonly type: 'gap'; readonly reason: 'overflow' | 'disconnected' | 'mapping-reset' }
  | { readonly type: 'closed'; readonly reason: 'stopped' | 'released' | 'shutdown' | 'source-lost' | 'consumer-error' }
export type ObservationSink = (event: ObservationPayload) => void | Promise<void>
export interface Observation {
  stop(): Promise<void>
}
export interface ThreadInput {
  readonly policies: readonly BusyPolicy[]
  submit(input: InputDraft): Promise<SubmitResult>
}
export interface ThreadHandle {
  readonly thread: Thread
  readonly input?: ThreadInput
  observe(sink: ObservationSink): Promise<OperationResult<Observation>>
  interrupt?: () => Promise<OperationResult<InterruptReceipt>>
  release(): Promise<void>
}
export interface AgentRuntime {
  open(ref: Thread): Promise<OperationResult<ThreadHandle>>
  shutdown(): Promise<OperationResult<ShutdownReceipt>>
}
