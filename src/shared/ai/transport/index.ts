import type { UniqueModelId } from '@shared/data/types/model'

export interface AiChatRequestBody {
  /** Topic ID for message routing and persistence. */
  topicId: string
  /** Explicit parent node — message id at the current branch tip, or null for first message. */
  parentAnchorId?: string
  /** Models mentioned via @ in the input (multi-model fan-out). */
  mentionedModels?: UniqueModelId[]
  /** Uploaded file metadata. */
  files?: Array<{ id: string; name: string; type: string; size: number; url: string }>
  /**
   * One-shot system prompt from a @-mentioned assistant. Overrides only the system prompt
   * for this request; all other assistant settings come from the topic's assistant.
   * Empty string is valid. Check with `!== undefined`, not truthiness.
   */
  temporarySystemPrompt?: string
  /** Name snapshot of the @-mentioned assistant, for display in message history. */
  temporaryAssistantName?: string
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
  ApprovalDecision,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
  TopicStatusSnapshotEntry,
  TopicStreamStatus
} from './stream'
export type { TurnStateFlags } from './turnState'
export { classifyTurn, TURN_STATE } from './turnState'
