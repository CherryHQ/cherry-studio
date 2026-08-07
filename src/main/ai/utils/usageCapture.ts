import type {
  AiUsageCaptureContext,
  AiUsageCredentialReceipt,
  MessageRef,
  SourceSnapshot
} from '@data/services/AiUsageRecordService'
import { type AiUsagePricingSnapshot, AiUsagePricingSnapshotSchema } from '@shared/data/types/aiUsageRecord'
import type { Currency, RuntimeModelPricing } from '@shared/data/types/model'

export interface CreateAiUsageCaptureContextInput {
  providerId: string
  providerName?: string | null
  modelId: string
  modelName?: string | null
  pricing?: RuntimeModelPricing | null
  pricingSnapshot?: AiUsagePricingSnapshot | null
  /** Scales every captured rate — 1.5 for MiniMax's priority tier, 1 otherwise. */
  priceMultiplier?: number
  trustProviderReportedCost?: boolean
  reportedCostCurrency?: Currency | null
  credentialReceipt?: AiUsageCredentialReceipt
  source?: SourceSnapshot | null
  messageRef?: MessageRef | null
  capturedAt?: string
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

function pricingCurrency(pricing: RuntimeModelPricing): AiUsagePricingSnapshot['currency'] | undefined {
  const currencies = [
    pricing.input?.currency,
    pricing.output?.currency,
    pricing.cacheRead?.currency,
    pricing.cacheWrite?.currency
  ].filter((currency): currency is AiUsagePricingSnapshot['currency'] => currency !== undefined)

  if (currencies.length === 0 || currencies.some((currency) => currency !== currencies[0])) return undefined
  return currencies[0]
}

/**
 * Freeze the pricing that applies to this request. `multiplier` scales every
 * rate so the snapshot records the *effective* price — surcharged routes like
 * MiniMax's priority tier need no second adjustment at cost time.
 */
export function createAiUsagePricingSnapshot(
  pricing: RuntimeModelPricing | null | undefined,
  capturedAt = new Date().toISOString(),
  multiplier = 1
): AiUsagePricingSnapshot | null {
  if (!pricing) return null
  const currency = pricingCurrency(pricing)
  if (!currency) return null

  const rate = (value: number) => value * multiplier

  const snapshot = {
    currency,
    ...(pricing.input?.perMillionTokens != null ? { inputPerMillionTokens: rate(pricing.input.perMillionTokens) } : {}),
    ...(pricing.output?.perMillionTokens != null
      ? { outputPerMillionTokens: rate(pricing.output.perMillionTokens) }
      : {}),
    ...(pricing.cacheRead?.perMillionTokens != null
      ? { cacheReadPerMillionTokens: rate(pricing.cacheRead.perMillionTokens) }
      : {}),
    ...(pricing.cacheWrite?.perMillionTokens != null
      ? { cacheWritePerMillionTokens: rate(pricing.cacheWrite.perMillionTokens) }
      : {}),
    ...(pricing.perImage
      ? {
          perImage: {
            price: rate(pricing.perImage.price),
            unit: pricing.perImage.unit ?? 'image'
          }
        }
      : {}),
    ...(pricing.thresholds?.length
      ? {
          thresholds: pricing.thresholds.map((threshold) => ({
            aboveInputTokens: threshold.aboveInputTokens,
            inputPerMillionTokens: rate(threshold.input),
            outputPerMillionTokens: rate(threshold.output),
            ...(threshold.cacheRead != null ? { cacheReadPerMillionTokens: rate(threshold.cacheRead) } : {}),
            ...(threshold.cacheWrite != null ? { cacheWritePerMillionTokens: rate(threshold.cacheWrite) } : {})
          }))
        }
      : {}),
    capturedAt
  }
  const parsed = AiUsagePricingSnapshotSchema.safeParse(snapshot)
  return parsed.success ? cloneAndFreeze(parsed.data) : null
}

/**
 * Freeze every attribution input after provider/model/credential selection and
 * before the provider call. Record completion must never consult mutable
 * provider, model, source, or rotation state.
 */
export function createAiUsageCaptureContext(input: CreateAiUsageCaptureContextInput): AiUsageCaptureContext {
  return cloneAndFreeze({
    providerId: input.providerId,
    providerName: input.providerName ?? null,
    modelId: input.modelId,
    modelName: input.modelName ?? null,
    pricingSnapshot:
      input.pricingSnapshot === undefined
        ? createAiUsagePricingSnapshot(input.pricing, input.capturedAt, input.priceMultiplier)
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
