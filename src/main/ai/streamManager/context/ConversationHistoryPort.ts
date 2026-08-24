/** History adapter contract for one accepted Conversation turn. */

import type { CompactionSink } from '@shared/ai/compaction'
import type { AgentConversationRef, ConversationRef } from '@shared/ai/conversation'
import type { ActiveNodeDecision, ApprovalDecision } from '@shared/ai/transport'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { ContextSettingsOverride } from '@shared/data/types/contextSettings'
import type {
  AssistantTurnOptions,
  CherryMessagePart,
  CherryUIMessage,
  MessageData,
  MessageRuntimeTiming,
  MessageSnapshot,
  MessageStatus
} from '@shared/data/types/message'
import type { Model, ServiceTierSelection, UniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import type { SerializedError } from '@shared/types/error'

import type { AiStreamRequest } from '../../types'
import type { StreamDoneResult, StreamErrorResult, StreamPausedResult } from '../types'
import type { MainDispatchRequest, MainSteerContinuationRequest } from './dispatch'

export interface ConversationExecutionContext {
  conversation: ConversationRef
  models: ReadonlyArray<{
    modelId: UniqueModelId
    request: AiStreamRequest
    runtimeTimingSeed?: MessageRuntimeTiming
    /** Renderer readers must not seed this execution from cached anchor parts. */
    seedFromEmpty?: boolean
  }>
}

export enum ConversationExecutionPreparationKind {
  PersistentChat = 'persistent-chat',
  TemporaryChat = 'temporary-chat',
  AgentFresh = 'agent-fresh',
  AgentRuntime = 'agent-runtime',
  Failure = 'failure'
}

export enum ConversationTerminalPersistenceKind {
  PersistentChat = 'persistent-chat',
  TemporaryChat = 'temporary-chat',
  Agent = 'agent'
}

export enum ConversationExecutionDriverBindingKind {
  Chat = 'chat',
  Agent = 'agent'
}

export enum ConversationAgentRuntimeTurnKind {
  Autonomous = 'autonomous',
  NativeContinuation = 'native-continuation'
}

export enum ConversationTelemetryKind {
  Chat = 'chat',
  Agent = 'agent'
}

export enum ConversationPostCommitTaskKind {
  RegisterTraceFlush = 'flush-trace',
  RenameChatFromFirstUser = 'rename-chat-from-first-user',
  RenameAgentFromFirstUser = 'rename-agent-from-first-user'
}

export enum ConversationAfterPersistTaskKind {
  RenameChatFromSummary = 'rename-chat-from-summary',
  RenameAgentFromSummary = 'rename-agent-from-summary'
}

export type ConversationExecutionPreparationDescriptor =
  | {
      readonly kind: ConversationExecutionPreparationKind.PersistentChat
      readonly conversation: ConversationRef
      readonly models: readonly Model[]
      readonly outputNodeIds: readonly string[]
      readonly historyAnchorId: string
      readonly assistantId?: string
      readonly contextSettingsOverride?: ContextSettingsOverride | null
      readonly turnOptions: AssistantTurnOptions
      readonly knowledgeBaseIds?: readonly string[]
      readonly steerReminder: boolean
    }
  | {
      readonly kind: ConversationExecutionPreparationKind.TemporaryChat
      readonly conversation: ConversationRef
      readonly modelId: UniqueModelId
      readonly outputNodeId: string
      readonly assistantId?: string
      readonly messages: readonly CherryUIMessage[]
      readonly knowledgeBaseIds?: readonly string[]
      readonly reasoningEffort?: ReasoningEffortOption
      readonly serviceTier?: ServiceTierSelection
      readonly fastMode: boolean
    }
  | {
      readonly kind: ConversationExecutionPreparationKind.AgentFresh
      readonly conversation: AgentConversationRef
      readonly agentId: string
      readonly agentType: string
      readonly modelId: UniqueModelId
      readonly reasoningEffort: ReasoningEffortOption
      readonly serviceTier: ServiceTierSelection
      readonly fastMode: boolean
      readonly outputNodeId: string
      readonly userMessage: AgentSessionMessageEntity
      readonly headless: boolean
      readonly traceId: string
      readonly messageSnapshot: MessageSnapshot
      readonly shouldAutoName: boolean
      readonly runtimeTurnId: string
    }
  | {
      readonly kind: ConversationExecutionPreparationKind.AgentRuntime
      readonly runtimeKind: ConversationAgentRuntimeTurnKind
      readonly conversation: AgentConversationRef
      readonly agentId: string
      readonly modelId: UniqueModelId
      readonly reasoningEffort: ReasoningEffortOption
      readonly serviceTier: ServiceTierSelection
      readonly fastMode: boolean
      readonly knowledgeBaseIds: readonly string[]
      readonly headless: boolean
      readonly userMessage: AgentSessionMessageEntity
      readonly outputNodeId: string
      readonly runtimeTurnId: string
      readonly sourceTurnId?: string
      readonly messageSnapshot?: MessageSnapshot
      readonly traceId?: string
    }
  | {
      readonly kind: ConversationExecutionPreparationKind.Failure
      readonly conversation: ConversationRef
      readonly error: SerializedError
    }

export type ConversationTerminalPersistenceDescriptor =
  | {
      readonly kind: ConversationTerminalPersistenceKind.PersistentChat
      readonly topicId: string
      readonly modelId: UniqueModelId
      readonly assistantMessageId: string
      readonly turnOptions?: AssistantTurnOptions
      readonly contextSettingsOverride?: ContextSettingsOverride | null
    }
  | {
      readonly kind: ConversationTerminalPersistenceKind.TemporaryChat
      readonly topicId: string
      readonly modelId: UniqueModelId
      readonly messageId: string
      readonly messageSnapshot?: MessageSnapshot
    }
  | {
      readonly kind: ConversationTerminalPersistenceKind.Agent
      readonly sessionId: string
      readonly assistantMessageId: string
      readonly modelId: UniqueModelId
    }

export type ConversationExecutionDriverBinding =
  | { readonly kind: ConversationExecutionDriverBindingKind.Chat }
  | {
      readonly kind: ConversationExecutionDriverBindingKind.Agent
      readonly runtimeTurnId: string
    }

export type ConversationTelemetryDescriptor =
  | {
      readonly kind: ConversationTelemetryKind.Chat
      readonly topicId: string
      readonly trigger: string
      readonly traceId: string
      readonly modelId: UniqueModelId
      readonly modelName: string
    }
  | {
      readonly kind: ConversationTelemetryKind.Agent
      readonly sessionId: string
      readonly trigger: string
      readonly traceId: string
      readonly modelId: UniqueModelId
      readonly modelName: string
      readonly agentId: string
      readonly agentName?: string
    }

export interface CommittedConversationExecution {
  readonly modelId: UniqueModelId
  readonly outputNodeId: string
  readonly runtimeTimingSeed?: MessageRuntimeTiming
  readonly seedFromEmpty?: boolean
  readonly preparation: ConversationExecutionPreparationDescriptor
  readonly preparationIndex: number
  readonly persistence: ConversationTerminalPersistenceDescriptor
  readonly afterPersist?: ConversationAfterPersistTaskDescriptor
  readonly telemetry?: ConversationTelemetryDescriptor
  readonly driver: ConversationExecutionDriverBinding
}

export interface CommittedConversationInput {
  readonly historyNodeId: string
  readonly pendingSteerReasoningEffort?: ReasoningEffortOption
  readonly pendingSteerServiceTier?: ServiceTierSelection
  readonly pendingSteerFastMode?: boolean
}

export type ConversationPostCommitTaskDescriptor =
  | {
      readonly kind: ConversationPostCommitTaskKind.RegisterTraceFlush
      readonly conversationId: string
    }
  | {
      readonly kind: ConversationPostCommitTaskKind.RenameChatFromFirstUser
      readonly topicId: string
      readonly userMessageId: string
    }
  | {
      readonly kind: ConversationPostCommitTaskKind.RenameAgentFromFirstUser
      readonly sessionId: string
      readonly userMessageData: MessageData
    }

export type ConversationTraceFlushTaskDescriptor = Extract<
  ConversationPostCommitTaskDescriptor,
  { readonly kind: ConversationPostCommitTaskKind.RegisterTraceFlush }
>

export type ConversationNamingPostCommitTaskDescriptor = Exclude<
  ConversationPostCommitTaskDescriptor,
  ConversationTraceFlushTaskDescriptor
>

export type ConversationAfterPersistTaskDescriptor =
  | {
      readonly kind: ConversationAfterPersistTaskKind.RenameChatFromSummary
      readonly topicId: string
      readonly assistantId?: string
      readonly userMessageId: string
    }
  | {
      readonly kind: ConversationAfterPersistTaskKind.RenameAgentFromSummary
      readonly agentId: string
      readonly sessionId: string
      readonly userText: string
    }

export interface CommittedConversationIntent {
  readonly conversation: ConversationRef
  readonly input: CommittedConversationInput
  readonly executions: readonly CommittedConversationExecution[]
  readonly reservedMessages: readonly CherryUIMessage[]
  readonly activeNodeDecision: ActiveNodeDecision
  readonly postCommitTasks: readonly ConversationPostCommitTaskDescriptor[]
}

export type ConversationTerminalWrite = StreamDoneResult | StreamPausedResult | StreamErrorResult

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

export enum ConversationExecutionMutationKind {
  Append = 'append',
  Retry = 'retry'
}

export interface ValidatedConversationExecutionMutation {
  readonly kind: ConversationExecutionMutationKind
  readonly outputNodeId: string
  readonly parentNodeId: string
  readonly siblingsGroupId: number
  readonly persistedSiblingsGroupId: number
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

export interface ValidatedAgentIntent {
  sessionId: string
  agentId: string
  agentUpdatedAt: string
  agentType: string
  agentName: string
  uniqueModelId: UniqueModelId
  reasoningEffort: ReasoningEffortOption
  serviceTier: ServiceTierSelection
  fastMode?: boolean
  headless: boolean
  messageSnapshot: MessageSnapshot
  userMessageId: string
  userMessageParts: CherryMessagePart[]
  deliveryMessage?: AgentSessionMessageEntity
  shouldAutoNameInitialTurn: boolean
}

export type ValidatedConversationIntent =
  | {
      readonly kind: ConversationHistoryAdapterKind.PersistentChat
      readonly request: MainDispatchRequest
      readonly context: ConversationIntentValidationContext
      readonly executionModelIds: readonly UniqueModelId[]
      readonly resolvedModels: Model[]
      readonly assistantId?: string
      readonly inputModelId: UniqueModelId
      readonly liveExecutionMutation?: ValidatedConversationExecutionMutation
    }
  | {
      readonly kind: ConversationHistoryAdapterKind.TemporaryChat
      readonly request: MainDispatchRequest
      readonly context: ConversationIntentValidationContext
      readonly executionModelIds: readonly UniqueModelId[]
      readonly resolvedModels: Model[]
      readonly assistantId?: string
    }
  | {
      readonly kind: ConversationHistoryAdapterKind.Agent
      readonly request: MainDispatchRequest
      readonly context: ConversationIntentValidationContext
      readonly executionModelIds: readonly UniqueModelId[]
      readonly agent: ValidatedAgentIntent
    }

export type ValidatedConversationInputFailure =
  | {
      readonly kind: ConversationHistoryAdapterKind.PersistentChat
      readonly request: MainSteerContinuationRequest
      readonly error: SerializedError
      readonly executionModelIds: readonly [UniqueModelId]
      readonly resolvedModel: Model
      readonly assistantId?: string
    }
  | {
      readonly kind: ConversationHistoryAdapterKind.Agent
      readonly request: MainDispatchRequest
      readonly error: SerializedError
      readonly executionModelIds: readonly [UniqueModelId]
      readonly agent: ValidatedAgentIntent
      readonly userMessage: AgentSessionMessageEntity
    }

export interface ConversationIntentValidationContext {
  /** True when the topic has a live stream at initial dispatch admission. */
  hasLiveStream: boolean
  /** Reject instead of enqueueing when the runtime becomes busy during preparation. */
  requireIdle?: boolean
  /** Internal callers may require the session's agent ownership at the message-write boundary. */
  expectedAgentId?: string
}

export interface ConversationCrashRecoveryResult {
  repairedOutputs: readonly {
    outputNodeId: string
    status: MessageStatus
  }[]
}

export interface ConversationHistoryPort {
  readonly name: string
  /** Admission-time ownership; temporary providers must opt out. */
  readonly isPersistentConversation: boolean

  /** Synchronous, side-effect free — runs on every request. */
  canHandle(conversation: ConversationRef): boolean
  recoverCrashOrphans?(): ConversationCrashRecoveryResult

  validateIntent(
    req: MainDispatchRequest,
    ctx: ConversationIntentValidationContext,
    signal: AbortSignal
  ): Promise<ValidatedConversationIntent>
  revalidateCommittedInput?(
    request: MainDispatchRequest,
    committedValidation: ValidatedConversationIntent,
    context: ConversationIntentValidationContext,
    signal: AbortSignal
  ): Promise<ValidatedConversationIntent>
  validateInputFailure?(
    request: MainDispatchRequest,
    error: SerializedError,
    committedValidation?: ValidatedConversationIntent
  ): ValidatedConversationInputFailure | undefined
  commitInputFailureIntent?(validation: ValidatedConversationInputFailure): CommittedConversationIntent
  commitInteractionDecision?(anchorId: string, decision: ApprovalDecision): ConversationInteractionCommitResult

  commitIntent(
    validation: ValidatedConversationIntent,
    context: ConversationIntentValidationContext
  ): CommittedConversationIntent
  prepareExecutionContext(
    descriptor: ConversationExecutionPreparationDescriptor,
    signal: AbortSignal,
    sink?: CompactionSink
  ): Promise<ConversationExecutionContext>
  persistTerminal(
    descriptor: ConversationTerminalPersistenceDescriptor,
    terminal: ConversationTerminalWrite
  ): Promise<void>
}
