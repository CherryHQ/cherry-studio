/** History adapter contract for one accepted Conversation turn. */

import type { Span } from '@opentelemetry/api'
import type { ConversationRef } from '@shared/ai/conversation'
import type { ApprovalDecision } from '@shared/ai/transport'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type {
  CherryMessagePart,
  CherryUIMessage,
  MessageRuntimeTiming,
  MessageSnapshot
} from '@shared/data/types/message'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import type { AiStreamRequest } from '../../types'
import type { StreamCleanupPort, StreamListener, StreamPersistencePort } from '../types'
import type { MainDispatchRequest } from './dispatch'

export enum LiveExecutionChangeMode {
  Replace = 'replace',
  Append = 'append'
}

type PreparedLiveExecutionChange =
  | { mode: LiveExecutionChangeMode.Replace; parentAnchorId: string; siblingsGroupId?: number }
  | {
      mode: LiveExecutionChangeMode.Append
      groupAnchorMessageId: string
      parentAnchorId: string
      siblingsGroupId: number
    }

export interface ConversationExecutionContext {
  conversation: ConversationRef
  models: ReadonlyArray<{
    modelId: UniqueModelId
    request: AiStreamRequest
    runtimeTimingSeed?: MessageRuntimeTiming
    /** Renderer readers must not seed this execution from cached anchor parts. */
    seedFromEmpty?: boolean
    rootSpan?: Span
    abortController?: AbortController
  }>
}

export enum ConversationHistoryAdapterKind {
  PersistentChat = 'persistent-chat',
  TemporaryChat = 'temporary-chat',
  Agent = 'agent'
}

export enum ConversationInteractionCommitResultKind {
  Missing = 'missing',
  Duplicate = 'duplicate',
  Pending = 'pending',
  Ready = 'ready'
}

export type ConversationInteractionCommitResult =
  | { readonly kind: ConversationInteractionCommitResultKind.Missing }
  | {
      readonly kind: ConversationInteractionCommitResultKind.Duplicate
      readonly continuation:
        | ConversationInteractionCommitResultKind.Pending
        | ConversationInteractionCommitResultKind.Ready
    }
  | {
      readonly kind: ConversationInteractionCommitResultKind.Pending | ConversationInteractionCommitResultKind.Ready
    }

export interface ValidatedAgentDispatch {
  sessionId: string
  agentId: string
  agentUpdatedAt: string
  agentType: string
  agentName: string
  uniqueModelId: UniqueModelId
  reasoningEffort: ReasoningEffortOption
  fastMode?: boolean
  headless: boolean
  messageSnapshot: MessageSnapshot
  userMessageId: string
  userMessageParts: CherryMessagePart[]
  deliveryMessage?: AgentSessionMessageEntity
  shouldAutoNameInitialTurn: boolean
}

export type ValidatedDispatch =
  | {
      readonly kind: ConversationHistoryAdapterKind.PersistentChat
      readonly request: MainDispatchRequest
      readonly context: DispatchContext
      readonly executionModelIds: readonly UniqueModelId[]
      readonly resolvedModels: Model[]
      readonly assistantId?: string
      readonly inputModelId: UniqueModelId
    }
  | {
      readonly kind: ConversationHistoryAdapterKind.TemporaryChat
      readonly request: MainDispatchRequest
      readonly context: DispatchContext
      readonly executionModelIds: readonly UniqueModelId[]
      readonly resolvedModels: Model[]
      readonly assistantId?: string
    }
  | {
      readonly kind: ConversationHistoryAdapterKind.Agent
      readonly request: MainDispatchRequest
      readonly context: DispatchContext
      readonly executionModelIds: readonly UniqueModelId[]
      readonly agent: ValidatedAgentDispatch
    }

export interface CommittedDispatchReservation {
  readonly conversation: ConversationRef
  readonly models: ReadonlyArray<{
    readonly modelId: UniqueModelId
    readonly outputNodeId: string
    readonly runtimeTimingSeed?: MessageRuntimeTiming
    readonly seedFromEmpty?: boolean
    readonly rootSpan?: Span
    readonly abortController?: AbortController
  }>
  readonly listeners: readonly StreamListener[]
  readonly persistencePorts: readonly StreamPersistencePort[]
  readonly cleanupPorts: readonly StreamCleanupPort[]
  readonly pendingSteerUserMessageId?: string
  readonly pendingSteerReasoningEffort?: ReasoningEffortOption
  readonly pendingSteerFastMode?: boolean
  readonly reservedMessages?: CherryUIMessage[]
  readonly siblingsGroupId?: number
  readonly liveExecutionChange?: PreparedLiveExecutionChange
}

export interface CommittedDispatch {
  readonly reservation: CommittedDispatchReservation
  prepareExecutionContext(signal: AbortSignal): Promise<ConversationExecutionContext>
}

export interface DispatchContext {
  /** True when the topic has a live stream at initial dispatch admission. */
  hasLiveStream: boolean
  /** Reject instead of enqueueing when the runtime becomes busy during preparation. */
  requireIdle?: boolean
  /** Internal callers may require the session's agent ownership at the message-write boundary. */
  expectedAgentId?: string
}

export interface ConversationHistoryPort {
  readonly name: string
  /** Admission-time ownership; temporary providers must opt out. */
  readonly isPersistentConversation: boolean

  /** Synchronous, side-effect free — runs on every request. */
  canHandle(conversation: ConversationRef): boolean

  validateDispatch(req: MainDispatchRequest, ctx: DispatchContext, signal: AbortSignal): Promise<ValidatedDispatch>
  commitDispatch(subscriber: StreamListener, validation: ValidatedDispatch, context: DispatchContext): CommittedDispatch
  commitInteractionDecision?(anchorId: string, decision: ApprovalDecision): ConversationInteractionCommitResult
}
