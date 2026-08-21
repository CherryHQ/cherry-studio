import type {
  ConversationExecutionId,
  ConversationOutcomeKind,
  ConversationRef,
  ConversationTurnId
} from '@shared/ai/conversation'
import type { CherryUIMessage, MessageRuntimeTiming } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

export type { CherryUIMessage }
export type {
  AiStreamAbortRequest,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamDetachRequest,
  AiStreamOpenRequest,
  AiStreamOpenResponse,
  ConversationExecutionProjection,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload
} from '@shared/ai/transport'
export type { CherryUIMessageChunk } from '@shared/data/types/message'

export interface TransportTimings {
  readonly startedAt: number
  completedAt?: number
}

interface StreamTerminalBase {
  finalMessage?: CherryUIMessage
  modelId?: UniqueModelId
  conversation?: ConversationRef
  turnId?: ConversationTurnId
  executionId?: ConversationExecutionId
  anchorMessageId?: string
  turnTerminal?: boolean
  timings?: TransportTimings
  runtimeTiming?: MessageRuntimeTiming
}

export interface StreamDoneResult extends StreamTerminalBase {
  status: ConversationOutcomeKind.Success
}

export interface StreamPausedResult extends StreamTerminalBase {
  status: ConversationOutcomeKind.Paused
}

export interface StreamErrorResult extends StreamTerminalBase {
  status: ConversationOutcomeKind.Error
  error: SerializedError
}

export enum StreamListenerAudience {
  Internal = 'internal',
  ExternalDelivery = 'external-delivery'
}

export interface StreamListener {
  readonly id: string
  readonly audience?: StreamListenerAudience
  onChunk(chunk: UIMessageChunk, identity?: ConversationStreamIdentity): void
  onDone(result: StreamDoneResult): void | Promise<void>
  onPaused(result: StreamPausedResult): void | Promise<void>
  onError(result: StreamErrorResult): void | Promise<void>
  isAlive(): boolean
}

export interface ConversationStreamIdentity {
  readonly conversation: ConversationRef
  readonly turnId: ConversationTurnId
  readonly executionId: ConversationExecutionId
  readonly modelId: UniqueModelId
  readonly outputNodeId: string
  readonly chunkSeq: number
  readonly throughChunkSeq: number
}

export interface StreamPersistencePort {
  readonly id: string
  onDone(result: StreamDoneResult): void | Promise<void>
  onPaused(result: StreamPausedResult): void | Promise<void>
  onError(result: StreamErrorResult): void | Promise<void>
}

export interface StreamCleanupPort {
  readonly id: string
  onTopicQuiesced(result: StreamDoneResult | StreamPausedResult | StreamErrorResult): void | Promise<void>
}

export interface ConversationCompletedEvent {
  conversation: ConversationRef
  turnId: string
  completedAt: number
}
