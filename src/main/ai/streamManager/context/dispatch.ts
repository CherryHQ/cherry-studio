import type { ConversationContinuationTrigger } from '@shared/ai/conversation'
import { type ConversationRef } from '@shared/ai/conversation'
import type { AiStreamOpenRequest, ApprovalDecision } from '@shared/ai/transport'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

export interface MainContinueConversationRequest {
  readonly trigger: ConversationContinuationTrigger.ContinueInteraction
  readonly conversation: ConversationRef
  readonly parentAnchorId: string
  readonly approvalDecisions: readonly ApprovalDecision[]
}

export interface MainSteerContinuationRequest {
  readonly trigger: ConversationContinuationTrigger.ContinueSteer
  readonly conversation: ConversationRef
  readonly userMessageId: string
  readonly reasoningEffort?: ReasoningEffortOption
  readonly fastMode: boolean
}

export type MainDispatchRequest = (
  | AiStreamOpenRequest
  | MainContinueConversationRequest
  | MainSteerContinuationRequest
) & {
  readonly headless?: boolean
  readonly agentDeliveryMessage?: AgentSessionMessageEntity
}
