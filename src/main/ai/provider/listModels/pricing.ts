import type { Currency, Model } from '@shared/data/types/model'
import { CURRENCY } from '@shared/data/types/model'
import type * as z from 'zod'

import type { NewApiPricingResponseSchema, VercelGatewayModelsResponseSchema } from '../listModelsSchemas'
import {
  BaiduModelPricingSchema,
  HuggingFaceModelPricingSchema,
  LanyunModelPricingSchema,
  OpenAITokenPricingSchema,
  PPIOModelPricingSchema
} from '../listModelsSchemas'

/** Negative sentinels stay `null` (known unknown); empty or invalid rates are absent. */
export function perMillion(perToken: string | null | undefined): number | null | undefined {
  if (perToken === null || perToken === undefined || perToken.trim() === '') return undefined
  const parsed = Number(perToken)
  if (!Number.isFinite(parsed)) return undefined
  return parsed < 0 ? null : parsed * 1_000_000
}

function tokenPricing(
  currency: Currency,
  price: {
    input?: number | null
    output?: number | null
    cacheRead?: number | null
    cacheWrite?: number | null
  }
): Model['pricing'] | undefined {
  if (price.input === undefined || price.output === undefined) return undefined
  return {
    input: tokenRate(currency, price.input),
    output: tokenRate(currency, price.output),
    ...(price.cacheRead !== undefined ? { cacheRead: tokenRate(currency, price.cacheRead) } : {}),
    ...(price.cacheWrite !== undefined ? { cacheWrite: tokenRate(currency, price.cacheWrite) } : {})
  }
}

export function usdPricing(price: {
  input?: number | null
  output?: number | null
  cacheRead?: number | null
  cacheWrite?: number | null
}): Model['pricing'] | undefined {
  return tokenPricing(CURRENCY.USD, price)
}

function tokenRate(currency: Currency, perMillionTokens: number | null) {
  return {
    currency,
    perMillionTokens: perMillionTokens === null ? null : Number(perMillionTokens.toPrecision(10))
  }
}

function usdRate(perMillionTokens: number | null) {
  return tokenRate(CURRENCY.USD, perMillionTokens)
}

type NewApiPricingResponse = z.infer<typeof NewApiPricingResponseSchema>
export type NewApiPricingItem = NewApiPricingResponse['data'][number]

const NEW_API_USD_PER_RATIO_UNIT = 2

function unknownPricing(currency: Currency): NonNullable<Model['pricing']> {
  const unknown = { currency, perMillionTokens: null }
  return { input: unknown, output: unknown }
}

export function unknownUsdPricing(): NonNullable<Model['pricing']> {
  return unknownPricing(CURRENCY.USD)
}

type VercelGatewayPricing = NonNullable<z.infer<typeof VercelGatewayModelsResponseSchema>['data'][number]['pricing']>
type VercelGatewayPricingTier = NonNullable<VercelGatewayPricing['input_tiers']>[number]

function vercelTierRate(
  base: string | undefined,
  tiers: VercelGatewayPricingTier[] | undefined,
  minInputTokens: number
): number | null | undefined {
  let rate = perMillion(base)
  for (const tier of [...(tiers ?? [])].sort((left, right) => left.min - right.min)) {
    if (tier.min > minInputTokens) break
    rate = perMillion(tier.cost)
  }
  return rate
}

export function vercelGatewayPricing(
  price: VercelGatewayPricing | undefined,
  modelType: string | undefined
): Model['pricing'] | undefined {
  if (!price) return undefined

  const perImage = price.image?.trim() ? Number(price.image) : undefined
  const output = price.output ?? (modelType === 'embedding' || modelType === 'reranking' ? '0' : undefined)
  const base =
    usdPricing({
      input: vercelTierRate(price.input, price.input_tiers, 0),
      output: vercelTierRate(output, price.output_tiers, 0),
      cacheRead: vercelTierRate(price.input_cache_read, price.input_cache_read_tiers, 0),
      cacheWrite: vercelTierRate(price.input_cache_write, price.input_cache_write_tiers, 0)
    }) ?? (perImage !== undefined && Number.isFinite(perImage) ? unknownUsdPricing() : undefined)
  if (!base) return undefined

  const thresholds = Array.from(
    new Set(
      [
        ...(price.input_tiers ?? []),
        ...(price.output_tiers ?? []),
        ...(price.input_cache_read_tiers ?? []),
        ...(price.input_cache_write_tiers ?? [])
      ]
        .map((tier) => tier.min)
        .filter((minimum) => minimum > 0 && Number.isSafeInteger(minimum))
    )
  ).sort((left, right) => left - right)
  const inputTokenTiers = thresholds.flatMap((minInputTokens) => {
    const input = vercelTierRate(price.input, price.input_tiers, minInputTokens)
    const tierOutput = vercelTierRate(output, price.output_tiers, minInputTokens)
    if (input === undefined || tierOutput === undefined) return []
    const cacheRead = vercelTierRate(price.input_cache_read, price.input_cache_read_tiers, minInputTokens)
    const cacheWrite = vercelTierRate(price.input_cache_write, price.input_cache_write_tiers, minInputTokens)
    return [
      {
        minInputTokens,
        input: usdRate(input),
        output: usdRate(tierOutput),
        ...(cacheRead !== undefined ? { cacheRead: usdRate(cacheRead) } : {}),
        ...(cacheWrite !== undefined ? { cacheWrite: usdRate(cacheWrite) } : {})
      }
    ]
  })

  return {
    ...base,
    ...(inputTokenTiers.length ? { inputTokenTiers } : {}),
    ...(perImage !== undefined && Number.isFinite(perImage)
      ? { perImage: { price: Number(perImage.toPrecision(10)), unit: 'image' as const } }
      : {})
  }
}

export function openAITokenPricing(value: unknown, currency: Currency): Model['pricing'] | undefined {
  const parsed = OpenAITokenPricingSchema.safeParse(value)
  if (!parsed.success) return undefined

  const price = parsed.data
  const cacheRead = perMillion(price.input_cache_read ?? price.input_cache_reads)
  const baseInput = perMillion(price.prompt)
  const baseOutput = perMillion(price.completion)
  const cacheWrite = perMillion(price.input_cache_write)
  const perImage = price.image?.trim() ? Number(price.image) : undefined
  const base =
    tokenPricing(currency, { input: baseInput, output: baseOutput, cacheRead, cacheWrite }) ??
    (perImage !== undefined && Number.isFinite(perImage) ? unknownPricing(currency) : undefined)
  if (!base) return undefined

  const inputTokenTiers = [...(price.context_pricing?.tiers ?? [])]
    .sort((left, right) => left.min_tokens - right.min_tokens)
    .flatMap((tier) => {
      if (!Number.isSafeInteger(tier.min_tokens) || tier.min_tokens <= 0) return []
      const tierInput = perMillion(tier.prompt)
      const tierOutput = perMillion(tier.completion)
      const tierCacheRead = perMillion(tier.input_cache_read ?? tier.input_cache_reads)
      const tierCacheWrite = perMillion(tier.input_cache_write)
      const input = tierInput === undefined ? baseInput : tierInput
      const output = tierOutput === undefined ? baseOutput : tierOutput
      if (input === undefined || output === undefined) return []
      return [
        {
          minInputTokens: tier.min_tokens,
          input: tokenRate(currency, input),
          output: tokenRate(currency, output),
          ...(tierCacheRead !== undefined || cacheRead !== undefined
            ? { cacheRead: tokenRate(currency, tierCacheRead === undefined ? cacheRead! : tierCacheRead) }
            : {}),
          ...(tierCacheWrite !== undefined || cacheWrite !== undefined
            ? { cacheWrite: tokenRate(currency, tierCacheWrite === undefined ? cacheWrite! : tierCacheWrite) }
            : {})
        }
      ]
    })

  return {
    ...base,
    ...(inputTokenTiers.length ? { inputTokenTiers } : {}),
    ...(perImage !== undefined && Number.isFinite(perImage)
      ? { perImage: { price: Number(perImage.toPrecision(10)), unit: 'image' as const } }
      : {})
  }
}

function decimalRate(value: string | undefined, multiplier = 1): number | null | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return parsed < 0 ? null : parsed * multiplier
}

export function ppioModelPricing(value: unknown): Model['pricing'] | undefined {
  const parsed = PPIOModelPricingSchema.safeParse(value)
  if (!parsed.success || !parsed.data.pricing) return undefined

  const price = parsed.data.pricing
  const baseInput = decimalRate(price.prompt?.price_per_m_decimal)
  const baseOutput = decimalRate(price.completion?.price_per_m_decimal)
  const cacheRead = decimalRate(price.input_cache_read?.price_per_m_decimal)
  const cacheWrite = decimalRate(price.input_cache_write?.price_per_m_decimal)
  const base = tokenPricing(CURRENCY.CNY, { input: baseInput, output: baseOutput, cacheRead, cacheWrite })
  if (!base) return undefined

  const inputTokenTiers = [...(parsed.data.tiered_billing_configs ?? [])]
    .sort((left, right) => left.min_tokens - right.min_tokens)
    .flatMap((tier) => {
      if (!Number.isSafeInteger(tier.min_tokens) || tier.min_tokens <= 1) return []
      const input = decimalRate(tier.pricing.prompt?.price_per_m_decimal) ?? baseInput
      const output = decimalRate(tier.pricing.completion?.price_per_m_decimal) ?? baseOutput
      const tierCacheRead = decimalRate(tier.pricing.input_cache_read?.price_per_m_decimal) ?? cacheRead
      const tierCacheWrite = decimalRate(tier.pricing.input_cache_write?.price_per_m_decimal) ?? cacheWrite
      if (input === undefined || output === undefined) return []
      return [
        {
          minInputTokens: tier.min_tokens,
          input: tokenRate(CURRENCY.CNY, input),
          output: tokenRate(CURRENCY.CNY, output),
          ...(tierCacheRead !== undefined ? { cacheRead: tokenRate(CURRENCY.CNY, tierCacheRead) } : {}),
          ...(tierCacheWrite !== undefined ? { cacheWrite: tokenRate(CURRENCY.CNY, tierCacheWrite) } : {})
        }
      ]
    })

  return { ...base, ...(inputTokenTiers.length ? { inputTokenTiers } : {}) }
}

type BaiduTokenPrice = NonNullable<NonNullable<z.infer<typeof BaiduModelPricingSchema>['pricing']>['prompt']>

function baiduRateAt(value: BaiduTokenPrice | undefined, inputTokens: number): number | null | undefined {
  if (typeof value === 'string') return decimalRate(value, 1_000)
  if (!value?.length) return undefined
  const tier = value.find((item) => item.up_to == null || inputTokens <= item.up_to * 1_000)
  return decimalRate(tier?.price, 1_000)
}

export function baiduModelPricing(value: unknown): Model['pricing'] | undefined {
  const parsed = BaiduModelPricingSchema.safeParse(value)
  if (!parsed.success || !parsed.data.pricing) return undefined

  const price = parsed.data.pricing
  const baseInput = baiduRateAt(price.prompt ?? undefined, 0)
  const baseOutput = baiduRateAt(price.completion ?? undefined, 0)
  const perImage = decimalRate(price.image ?? undefined)
  const base =
    tokenPricing(CURRENCY.CNY, { input: baseInput, output: baseOutput }) ??
    (perImage !== undefined && Number.isFinite(perImage) ? unknownPricing(CURRENCY.CNY) : undefined)
  if (!base) return undefined

  const thresholds = Array.from(
    new Set(
      [price.prompt, price.completion]
        .flatMap((tokenPrice) => (Array.isArray(tokenPrice) ? tokenPrice : []))
        .flatMap((tier) => (tier.up_to == null ? [] : [tier.up_to * 1_000 + 1]))
        .filter((minimum) => Number.isSafeInteger(minimum) && minimum > 0)
    )
  ).sort((left, right) => left - right)
  const inputTokenTiers = thresholds.flatMap((minInputTokens) => {
    const input = baiduRateAt(price.prompt ?? undefined, minInputTokens)
    const output = baiduRateAt(price.completion ?? undefined, minInputTokens)
    if (input === undefined || output === undefined) return []
    return [
      {
        minInputTokens,
        input: tokenRate(CURRENCY.CNY, input),
        output: tokenRate(CURRENCY.CNY, output)
      }
    ]
  })

  return {
    ...base,
    ...(inputTokenTiers.length ? { inputTokenTiers } : {}),
    ...(perImage !== null && perImage !== undefined && Number.isFinite(perImage)
      ? { perImage: { price: Number(perImage.toPrecision(10)), unit: 'image' as const } }
      : {})
  }
}

export function lanyunModelPricing(value: unknown): Model['pricing'] | undefined {
  const parsed = LanyunModelPricingSchema.safeParse(value)
  if (!parsed.success) return undefined
  const rules = [...(parsed.data.x_lanyun?.price_rules ?? [])].sort(
    (left, right) => (left.token_range_start ?? 0) - (right.token_range_start ?? 0)
  )
  const baseRule = rules.find((rule) => (rule.token_range_start ?? 0) <= 0)
  if (!baseRule) return undefined
  const base = tokenPricing(CURRENCY.CNY, {
    input:
      baseRule.input_text_token_price == null
        ? undefined
        : Number((baseRule.input_text_token_price * 1_000).toPrecision(10)),
    output:
      baseRule.output_text_token_price == null
        ? undefined
        : Number((baseRule.output_text_token_price * 1_000).toPrecision(10)),
    cacheRead:
      baseRule.cached_text_token_price == null
        ? undefined
        : Number((baseRule.cached_text_token_price * 1_000).toPrecision(10)),
    cacheWrite:
      baseRule.cache_creation_5m_token == null
        ? undefined
        : Number((baseRule.cache_creation_5m_token * 1_000).toPrecision(10))
  })
  if (!base) return undefined

  const inputTokenTiers = rules.flatMap((rule) => {
    const minInputTokens = rule.token_range_start ?? 0
    if (!Number.isSafeInteger(minInputTokens) || minInputTokens <= 0) return []
    if (rule.input_text_token_price == null || rule.output_text_token_price == null) return []
    return [
      {
        minInputTokens,
        input: tokenRate(CURRENCY.CNY, rule.input_text_token_price * 1_000),
        output: tokenRate(CURRENCY.CNY, rule.output_text_token_price * 1_000),
        ...(rule.cached_text_token_price != null
          ? { cacheRead: tokenRate(CURRENCY.CNY, rule.cached_text_token_price * 1_000) }
          : {}),
        ...(rule.cache_creation_5m_token != null
          ? { cacheWrite: tokenRate(CURRENCY.CNY, rule.cache_creation_5m_token * 1_000) }
          : {})
      }
    ]
  })

  return { ...base, ...(inputTokenTiers.length ? { inputTokenTiers } : {}) }
}

export function huggingFaceModelPricing(value: unknown): Model['pricing'] | undefined {
  const parsed = HuggingFaceModelPricingSchema.safeParse(value)
  if (!parsed.success || !parsed.data.providers?.length) return undefined
  const prices = parsed.data.providers.map((provider) => provider.pricing)
  if (prices.some((price) => !price)) return unknownUsdPricing()
  const [first, ...rest] = prices as Array<{ input: number; output: number }>
  if (rest.some((price) => price.input !== first.input || price.output !== first.output)) return unknownUsdPricing()
  return usdPricing(first)
}

export function newApiGroupMultiplier(response: NewApiPricingResponse): number {
  const groups = Object.keys(response.usable_group ?? {})
  const group = groups.length === 1 ? groups[0] : 'default'
  return response.group_ratio?.[group] ?? 1
}

export function newApiPricing(entry: NewApiPricingItem, groupMultiplier: number): NonNullable<Model['pricing']> {
  if (entry.billing_mode) return unknownUsdPricing()
  if (entry.quota_type === 1 || entry.model_ratio === undefined) return unknownUsdPricing()
  const input = entry.model_ratio * NEW_API_USD_PER_RATIO_UNIT * groupMultiplier
  return usdPricing({
    input,
    output: input * (entry.completion_ratio ?? 1),
    cacheRead: entry.cache_ratio === undefined ? undefined : input * entry.cache_ratio
  })!
}
