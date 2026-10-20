import type {
  AiUsageCaptureContext,
  AiUsageCredentialReceipt,
  MessageRef,
  SourceSnapshot
} from '@data/services/AiUsageRecordService'
import { type AiUsagePricingSnapshot, AiUsagePricingSnapshotSchema } from '@shared/data/types/aiUsageRecord'
import type { Currency, RuntimeModelPricing } from '@shared/data/types/model'
import type { ProviderBilling } from '@shared/data/types/providerBilling'
import { resolveProviderBilling } from '@shared/utils/providerBilling'
import { createAiUsagePricingSnapshot as buildPricingSnapshot } from '@shared/utils/usagePricing'

export interface CreateAiUsageCaptureContextInput {
  providerId: string
  providerName?: string | null
  modelId: string
  modelName?: string | null
  pricing?: RuntimeModelPricing | null
  pricingSnapshot?: AiUsagePricingSnapshot | null
  trustProviderReportedCost?: boolean
  reportedCostCurrency?: Currency | null
  credentialReceipt?: AiUsageCredentialReceipt
  source?: SourceSnapshot | null
  messageRef?: MessageRef | null
  capturedAt?: string
  billing?: ProviderBilling
  billingModelId?: string
  invocationStartedAt?: Date | null
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function cloneAndFreeze<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value))
}

export function createAiUsagePricingSnapshot(
  ...args: Parameters<typeof buildPricingSnapshot>
): AiUsagePricingSnapshot | null {
  const snapshot = buildPricingSnapshot(...args)
  return snapshot ? cloneAndFreeze(snapshot) : null
}

/**
 * Freeze every attribution input after provider/model/credential selection and
 * before the provider call. Record completion must never consult mutable
 * provider, model, source, or rotation state.
 */
export function createAiUsageCaptureContext(input: CreateAiUsageCaptureContextInput): AiUsageCaptureContext {
  const resolved = resolveProviderBilling(
    input.pricing,
    input.billing,
    input.billingModelId ?? input.modelId,
    input.invocationStartedAt === undefined ? new Date(input.capturedAt ?? Date.now()) : input.invocationStartedAt
  )
  const pricing = buildPricingSnapshot(resolved.pricing, input.capturedAt)
  if (pricing && resolved.billing) pricing.billing = resolved.billing
  return cloneAndFreeze({
    providerId: input.providerId,
    providerName: input.providerName ?? null,
    modelId: input.modelId,
    modelName: input.modelName ?? null,
    pricingSnapshot:
      input.pricingSnapshot === undefined
        ? pricing
        : input.pricingSnapshot === null
          ? null
          : (() => {
              const parsed = AiUsagePricingSnapshotSchema.safeParse(input.pricingSnapshot)
              return parsed.success ? cloneAndFreeze(parsed.data) : null
            })(),
    trustProviderReportedCost: input.trustProviderReportedCost === true,
    reportedCostCurrency: input.reportedCostCurrency ?? null,
    credentialReceipt: cloneAndFreeze(input.credentialReceipt ?? { attribution: 'unknown' }),
    source: input.source === undefined ? null : input.source === null ? null : cloneAndFreeze(input.source),
    messageRef:
      input.messageRef === undefined ? null : input.messageRef === null ? null : cloneAndFreeze(input.messageRef)
  })
}
