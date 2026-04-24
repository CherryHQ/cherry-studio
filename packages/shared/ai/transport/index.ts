import type { UniqueModelId } from '@shared/data/types/model'

export interface AiChatRequestBody {
  /** Topic ID for message routing and persistence. */
  topicId: string
  /** Explicit parent node — message id at the current branch tip, or null for first message. */
  parentAnchorId?: string | null
  /** Models mentioned via @ in the input (multi-model fan-out). */
  mentionedModels?: UniqueModelId[]
  /** Uploaded file metadata. */
  files?: Array<{ id: string; name: string; type: string; size: number; url: string }>
  /**
   * Opt this request's stream into per-execution chunk tagging (see
   * `AiStreamOpenRequest.alwaysTagExecution`). Threaded through by
   * `IpcChatTransport.sendMessages` into the `streamOpen` IPC.
   */
  alwaysTagExecution?: boolean
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
