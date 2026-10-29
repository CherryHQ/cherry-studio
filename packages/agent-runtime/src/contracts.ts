import type { UIMessage } from 'ai'

declare const identity: unique symbol
export type RuntimeId<K extends string> = string & { readonly [identity]: K }
export type BackendId = RuntimeId<'backend'>
export type ThreadId = RuntimeId<'thread'>
export type InputId = RuntimeId<'input'>
export type ItemId = RuntimeId<'item'>
export type DelegationId = RuntimeId<'delegation'>
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
export interface DelegationRef {
  readonly session: Thread
  readonly id: DelegationId
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
export type Completeness = 'partial' | 'complete' | 'unknown'
/** One native conversation message; tools and their results remain in its ordered parts. */
export type RuntimeMessage = UIMessage<{
  completeness: Completeness
  inputId?: InputId
}>
export interface Delegation {
  readonly ref: DelegationRef
  readonly parent: Thread
  readonly child: Thread
  readonly trigger?: ItemRef
  readonly status: 'active' | 'completed' | 'unknown'
}
export interface Activity {
  readonly scope: 'foreground'
  readonly state: 'active' | 'idle' | 'unknown'
}
export interface ThreadSnapshot {
  readonly type: 'snapshot'
  readonly coverage: 'live-only' | 'current-view' | 'retained-view'
  readonly messages: readonly RuntimeMessage[]
  readonly inputs: readonly InputState[]
  readonly delegations?: readonly Delegation[]
  readonly activity: Activity
}
export type ObservationPayload =
  | ThreadSnapshot
  | { readonly type: 'message.upsert'; readonly message: RuntimeMessage; readonly replaces?: readonly ItemRef[] }
  | { readonly type: 'message.remove'; readonly ref: ItemRef }
  | { readonly type: 'input.changed'; readonly input: InputState }
  | { readonly type: 'activity.changed'; readonly activity: Activity }
  | { readonly type: 'delegation.upsert'; readonly delegation: Delegation }
  | { readonly type: 'diagnostic'; readonly error: RuntimeError }
  | { readonly type: 'gap'; readonly reason: 'overflow' | 'disconnected' | 'mapping-reset' }
  | { readonly type: 'closed'; readonly reason: 'stopped' | 'released' | 'shutdown' | 'source-lost' | 'consumer-error' }
export type ObservationSink = (event: ObservationPayload) => void | Promise<void>
export interface Observation {
  stop(): Promise<void>
}
export interface ThreadHandle {
  readonly thread: Thread
  readonly inputPolicies: readonly BusyPolicy[]
  submit(input: InputDraft): Promise<SubmitResult>
  observe(sink: ObservationSink): Promise<OperationResult<Observation>>
  interrupt?: () => Promise<OperationResult<InterruptReceipt>>
  release(): Promise<void>
}
export interface AgentRuntime {
  open(ref: Thread): Promise<OperationResult<ThreadHandle>>
  shutdown(): Promise<OperationResult<ShutdownReceipt>>
}
