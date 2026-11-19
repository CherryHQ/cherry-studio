import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { ComposerChatTarget } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ServiceTierSelection, UniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

/** Renderer-owned queued draft; attachments become message file parts only when sent. */
export interface ComposerQueuedMessagePayload {
  text: string
  userMessageParts: CherryMessagePart[]
  /** In-memory attachments retained for draft editing and send-time file creation. */
  attachments?: ComposerAttachment[]
  /** Models selected by the composer model selector for this queued draft. */
  mentionedModels?: UniqueModelId[]
  /** Canonical reasoning selection captured with this queued draft. */
  reasoningEffort?: ReasoningEffortOption
  /** Canonical provider request tier captured with this queued draft. */
  serviceTier?: ServiceTierSelection
  /** Whether this queued draft requests Fast processing. */
  fastMode?: boolean
  /** Chat-only target snapshot. Agent-session queues leave this unset. */
  chatTarget?: ComposerChatTarget
}
