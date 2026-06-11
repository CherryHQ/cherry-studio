import type { CherryMessagePart } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

export interface AiChatRequestBody {
  /** Topic ID for message routing and persistence. */
  topicId: string
  /** Explicit parent node — message id at the current branch tip, or null for first message. */
  parentAnchorId?: string
  /** Models selected by the composer model selector (multi-model fan-out). */
  mentionedModels?: UniqueModelId[]
  /** User message parts to persist/display for submit-message turns. */
  userMessageParts?: CherryMessagePart[]
  /** Uploaded file metadata. */
  files?: Array<{ id: string; name: string; type: string; size: number; url: string }>
}

export { applyApprovalDecisions } from './applyApprovalDecisions'
export type {
  ActiveExecution,
  AiAgentSessionWarmCloseRequest,
  AiAgentSessionWarmRequest,
  AiStreamAbortRequest,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamDetachRequest,
  AiStreamOpenRequest,
  AiStreamOpenResponse,
  AiToolApprovalRespondRequest,
  AiToolApprovalRespondResponse,
  ApprovalDecision,
  ComposerQueuedMessagePayload,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
  TopicStatusSnapshotEntry,
  TopicStreamStatus
} from './stream'
export type { TurnStateFlags } from './turnState'
export { classifyTurn, TURN_STATE } from './turnState'
