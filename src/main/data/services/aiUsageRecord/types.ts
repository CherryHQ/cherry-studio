import type {
  AiUsageCostBreakdown,
  AiUsagePricingSnapshot,
  AiUsageRecordAuthMethod,
  AiUsageRecordCostSource,
  AiUsageRecordMessageKind,
  AiUsageRecordModality,
  AiUsageRecordSourceType
} from '@shared/data/types/aiUsageRecord'
import type { MessageStats } from '@shared/data/types/message'
import type { Currency } from '@shared/data/types/model'

/**
 * Non-secret receipt captured by the component that selected the serving
 * credential. The raw credential never crosses into usage persistence.
 */
export type AiUsageCredentialReceipt =
  | {
      attribution: 'explicit' | 'matched'
      id: string
      label?: string
      masked: string
    }
  | { attribution: 'auth'; method: AiUsageRecordAuthMethod }
  | { attribution: 'unknown' }

export interface SourceSnapshot {
  type: AiUsageRecordSourceType
  id: string
  name: string | null
  icon: string | null
}

export interface MessageRef {
  kind: AiUsageRecordMessageKind
  id: string
}

export interface AiUsageCaptureContext {
  providerId: string
  providerName: string | null
  modelId: string
  modelName: string | null
  pricingSnapshot: AiUsagePricingSnapshot | null
  trustProviderReportedCost: boolean
  credentialReceipt: AiUsageCredentialReceipt
  source: SourceSnapshot | null
  messageRef: MessageRef | null
}

export interface AiUsageProviderCost {
  amount: number
  currency: Currency
  breakdown?: AiUsageCostBreakdown
}

export interface RecordAiInvocationInput {
  requestId: string
  context: AiUsageCaptureContext
  modality: AiUsageRecordModality
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    reasoningTokens?: number
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  imageCount?: number
  providerCost?: AiUsageProviderCost
  metrics?: {
    timeFirstTokenMs?: number
    timeCompletionMs?: number
    timeThinkingMs?: number
  }
  completedAt: number
}

export interface LegacyAggregateInput {
  requestId: string
  requestCount: number
  messageRef: MessageRef
  providerId?: string | null
  providerName?: string | null
  modelId?: string | null
  modelName?: string | null
  source?: SourceSnapshot | null
  usage: RecordAiInvocationInput['usage']
  cost?: {
    amount: number
    currency: Currency
    source: AiUsageRecordCostSource
    breakdown?: AiUsageCostBreakdown
    pricingSnapshot?: AiUsagePricingSnapshot
  }
  modality?: AiUsageRecordModality
  createdAt: number
}

export type MessageUsageProjection = Pick<
  MessageStats,
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'inputTokenDetails'
  | 'outputTokenDetails'
  | 'requestCount'
  | 'estimatedRequestCount'
  | 'unpricedRequestCount'
  | 'costs'
  | 'providerPerformance'
>

/**
 * Agent-session usage has exactly one capture owner per runtime route.
 * Direct/external SDK routes emit per-assistant-message invocation records;
 * gateway routes are captured by the normal provider-call middleware.
 */
export type AgentSessionUsageCapture =
  | {
      owner: 'agent-sdk'
      credentialReceipt: AiUsageCredentialReceipt
      providerId: string
      providerName: string | null
      source: SourceSnapshot | null
      frozenModels: ReadonlyArray<{
        modelId: string
        modelName: string | null
        aliases: readonly string[]
        pricingSnapshot: AiUsagePricingSnapshot | null
      }>
    }
  | { owner: 'provider-calls' }
