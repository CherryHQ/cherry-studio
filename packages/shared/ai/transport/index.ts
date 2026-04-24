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
}

export type {
  AiStreamAbortRequest,
  AiStreamAttachRequest,
  AiStreamAttachResponse,
  AiStreamDetachRequest,
  AiStreamOpenRequest,
  AiStreamOpenResponse,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
  TopicStatusSnapshotEntry,
  TopicStreamStatus
} from './stream'
