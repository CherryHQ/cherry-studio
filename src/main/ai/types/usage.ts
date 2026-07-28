import type {
  AiUsageCostBreakdown,
  AiUsagePricingSnapshot,
  AiUsageRecordAuthMethod,
  AiUsageRecordMessageKind,
  AiUsageRecordModality,
  AiUsageRecordSourceType
} from '@shared/data/types/aiUsageRecord'
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
  reportedCostCurrency: Currency | null
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
