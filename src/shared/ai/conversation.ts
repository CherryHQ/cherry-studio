/** Stable conversation namespace shared by Main and Renderer. */
export enum ConversationKind {
  Chat = 'chat',
  Agent = 'agent'
}

/** Business lifecycle owned by the Conversation aggregate. */
export enum ConversationPhase {
  Idle = 'idle',
  Running = 'running',
  Stopping = 'stopping'
}

/** Why one logical turn was opened. */
export enum ConversationTurnKind {
  Submit = 'submit',
  Regenerate = 'regenerate',
  RuntimeInitiated = 'runtime-initiated'
}

/** Control lifecycle for one logical execution inside a turn. */
export enum ConversationExecutionPhase {
  Starting = 'starting',
  Active = 'active',
  WaitingInteraction = 'waiting-interaction',
  Persisting = 'persisting',
  Settled = 'settled'
}

/** Inbox boundary selected for accepted input. */
export enum ConversationInputTarget {
  NextTurn = 'next-turn',
  NextStep = 'next-step'
}

/** Stable terminal outcome selected before persistence. */
export enum ConversationOutcomeKind {
  Success = 'success',
  Error = 'error',
  Paused = 'paused'
}

/** Whether the published terminal already has its durable row. */
export enum ConversationTerminalDurability {
  Durable = 'durable',
  DeferredRecovery = 'deferred-recovery'
}

/** Interaction kind presented while an execution waits for input. */
export enum ConversationInteractionKind {
  ToolApproval = 'tool-approval',
  AskUser = 'ask-user'
}

/** Lifecycle for an interaction owned by the active turn. */
export enum ConversationInteractionPhase {
  Observed = 'observed',
  Available = 'available',
  Resolving = 'resolving',
  Resolved = 'resolved'
}

/** How an ExecutionDriver continues after an interaction is resolved. */
export enum ConversationInteractionResumeMode {
  NewRun = 'new-run',
  InPlace = 'in-place'
}

/** Work outside the foreground provider run that affects admission or quiescence. */
export enum ConversationActivityKind {
  Background = 'background',
  Compaction = 'compaction',
  Autonomous = 'autonomous',
  TerminalRecovery = 'terminal-recovery'
}

export enum ConversationAdmissionReason {
  SingleModelRequired = 'SINGLE_MODEL_REQUIRED',
  TargetNotInLiveGroup = 'TARGET_NOT_IN_LIVE_GROUP',
  ModelAlreadyInLiveGroup = 'MODEL_ALREADY_IN_LIVE_GROUP',
  ExecutionNotReady = 'EXECUTION_NOT_READY',
  ExecutionChanged = 'EXECUTION_CHANGED',
  ConversationBusy = 'TOPIC_BUSY'
}

/** Public command accepted by the Conversation IPC boundary. */
export enum ConversationOpenTrigger {
  SubmitMessage = 'submit-message',
  RegenerateMessage = 'regenerate-message'
}

/** Main-only history continuations translated into Conversation commands. */
export enum ConversationContinuationTrigger {
  ContinueInteraction = 'continue-conversation',
  ContinueSteer = 'steer-continuation'
}

/** How a Chat input targets its durable tree. */
export enum ConversationTargetMode {
  ActivePath = 'active-path',
  ReservedBranch = 'reserved-branch'
}

/** Admission response returned to a submitter. */
export enum ConversationOpenMode {
  Started = 'started',
  Injected = 'injected',
  Blocked = 'blocked'
}

/** Why an input could not enter its Conversation. */
export enum ConversationBlockReason {
  AgentSessionWorkspace = 'agent-session-workspace',
  Paused = 'paused'
}

/** Active-node mutation decided while durable skeletons are created. */
export enum ConversationActiveNodeMove {
  Advance = 'advance',
  Keep = 'keep'
}

/** Renderer-facing projection of the aggregate lifecycle. */
export enum ConversationStatus {
  Pending = 'pending',
  Streaming = 'streaming',
  Done = 'done',
  Aborted = 'aborted',
  AwaitingInteraction = 'awaiting-interaction',
  Error = 'error'
}

/** Result of attaching an observer to the resource data plane. */
export enum ConversationAttachStatus {
  NotFound = 'not-found',
  Attached = 'attached',
  Done = 'done',
  Paused = 'paused',
  Error = 'error'
}

/** Stable conversation identity without synthetic topic prefixes. */
export type ConversationRef =
  | { readonly kind: ConversationKind.Chat; readonly id: string }
  | { readonly kind: ConversationKind.Agent; readonly id: string }

export type ChatConversationRef = Extract<ConversationRef, { readonly kind: ConversationKind.Chat }>
export type AgentConversationRef = Extract<ConversationRef, { readonly kind: ConversationKind.Agent }>

export type ConversationTurnId = string & { readonly __conversationTurnId: unique symbol }
export type ConversationExecutionId = string & { readonly __conversationExecutionId: unique symbol }
export type ConversationEffectId = string & { readonly __conversationEffectId: unique symbol }
export type ConversationInteractionId = string & { readonly __conversationInteractionId: unique symbol }
export type ConversationActivityId = string & { readonly __conversationActivityId: unique symbol }
export type ConversationInputId = string & { readonly __conversationInputId: unique symbol }

export const toConversationTurnId = (value: string): ConversationTurnId => value as ConversationTurnId
export const toConversationExecutionId = (value: string): ConversationExecutionId => value as ConversationExecutionId
export const toConversationEffectId = (value: string): ConversationEffectId => value as ConversationEffectId
export const toConversationInteractionId = (value: string): ConversationInteractionId =>
  value as ConversationInteractionId
export const toConversationActivityId = (value: string): ConversationActivityId => value as ConversationActivityId
export const toConversationInputId = (value: string): ConversationInputId => value as ConversationInputId

/** Deterministic process-local registry key for a namespaced conversation. */
export const conversationRefKey = (ref: ConversationRef): string => `${ref.kind}:${ref.id}`

export const conversationRefsEqual = (left: ConversationRef, right: ConversationRef): boolean =>
  left.kind === right.kind && left.id === right.id
