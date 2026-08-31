import type {
  AiUsageCaptureContext,
  AiUsageCredentialReceipt,
  MessageRef,
  SourceSnapshot
} from '@data/services/AiUsageRecordService'
import { type AiUsagePricingSnapshot, AiUsagePricingSnapshotSchema } from '@shared/data/types/aiUsageRecord'
import type { Currency, RuntimeModelPricing } from '@shared/data/types/model'
import { compileModelPricingPolicy, projectModelPricingAt, type TokenPricing } from '@shared/utils/modelPricing'

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

export function freezeAiUsagePricing(pricing: RuntimeModelPricing | null | undefined): RuntimeModelPricing | null {
  return pricing ? (cloneAndFreeze(pricing) as RuntimeModelPricing) : null
}

function pricingCurrency(pricing: TokenPricing[]): AiUsagePricingSnapshot['currency'] | undefined {
  const tokenRates = pricing
    .flatMap((rates) => [rates.input, rates.output, rates.cacheRead, rates.cacheWrite])
    .filter((rate) => rate !== undefined)
  const explicitCurrencies = tokenRates
    .map((rate) => rate.currency)
    .filter((currency): currency is AiUsagePricingSnapshot['currency'] => currency !== undefined)
  if (explicitCurrencies.length === 0) return undefined
  if (explicitCurrencies.some((currency) => currency !== explicitCurrencies[0])) return undefined
  return explicitCurrencies[0]
}

export function createAiUsagePricingSnapshot(
  pricing: RuntimeModelPricing | null | undefined,
  startedAt: string
): AiUsagePricingSnapshot | null {
  if (!pricing) return null
  const startedDate = new Date(startedAt)
  if (Number.isNaN(startedDate.getTime())) return null
  const policy = compileModelPricingPolicy(pricing)
  const projection = projectModelPricingAt(policy, startedDate)
  const effectivePricing = projection.base.rates
  const currency = pricingCurrency([effectivePricing, ...projection.tiers.map((tier) => tier.resolution.rates)])
  if (!currency) return null

  const snapshot = {
    currency,
    ...(effectivePricing.input?.perMillionTokens != null
      ? { inputPerMillionTokens: effectivePricing.input.perMillionTokens }
      : {}),
    ...(effectivePricing.output?.perMillionTokens != null
      ? { outputPerMillionTokens: effectivePricing.output.perMillionTokens }
      : {}),
    ...(effectivePricing.cacheRead?.perMillionTokens != null
      ? { cacheReadPerMillionTokens: effectivePricing.cacheRead.perMillionTokens }
      : {}),
    ...(effectivePricing.cacheWrite?.perMillionTokens != null
      ? { cacheWritePerMillionTokens: effectivePricing.cacheWrite.perMillionTokens }
      : {}),
    ...(projection.tiers.length
      ? {
          inputTokenTiers: projection.tiers.map(({ minInputTokens, resolution }) => ({
            minInputTokens,
            ...(resolution.rates.input.perMillionTokens != null
              ? { inputPerMillionTokens: resolution.rates.input.perMillionTokens }
              : {}),
            ...(resolution.rates.output.perMillionTokens != null
              ? { outputPerMillionTokens: resolution.rates.output.perMillionTokens }
              : {}),
            ...(resolution.rates.cacheRead?.perMillionTokens != null
              ? { cacheReadPerMillionTokens: resolution.rates.cacheRead.perMillionTokens }
              : {}),
            ...(resolution.rates.cacheWrite?.perMillionTokens != null
              ? { cacheWritePerMillionTokens: resolution.rates.cacheWrite.perMillionTokens }
              : {})
          }))
        }
      : {}),
    ...(policy.pricing.perImage
      ? {
          perImage: {
            price: policy.pricing.perImage.price,
            unit: policy.pricing.perImage.unit ?? 'image'
          }
        }
      : {}),
    capturedAt: startedAt
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
  const frozenPricing = freezeAiUsagePricing(input.pricing)
  return cloneAndFreeze({
    providerId: input.providerId,
    providerName: input.providerName ?? null,
    modelId: input.modelId,
    modelName: input.modelName ?? null,
    pricingSnapshot:
      input.pricingSnapshot === undefined
        ? input.capturedAt
          ? createAiUsagePricingSnapshot(frozenPricing, input.capturedAt)
          : null
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
      input.messageRef === undefined ? null : input.messageRef === null ? null : cloneAndFreeze(input.messageRef),
    frozenPricing
  })
}

export function captureAiUsagePricingAt(context: AiUsageCaptureContext, startedAt: number): AiUsageCaptureContext {
  if (!Number.isFinite(startedAt) || startedAt < 0) return context
  return cloneAndFreeze({
    ...context,
    pricingSnapshot: context.frozenPricing
      ? createAiUsagePricingSnapshot(context.frozenPricing, new Date(startedAt).toISOString())
      : context.pricingSnapshot
  })
}
