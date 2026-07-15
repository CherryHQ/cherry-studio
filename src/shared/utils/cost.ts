/**
 * Pure cost helpers for message stats.
 *
 * `computeLanguageCost` turns token usage + a model's pricing into an
 * aggregate cost plus a per-bucket breakdown. `extractProviderCost` pulls a
 * provider-reported cost out of the raw usage blob (e.g. OpenRouter
 * `usage.cost`). Both are pure so the main process (persistence) and the
 * renderer (display fallback) share one implementation.
 */

import { CURRENCY, type Currency } from '@cherrystudio/provider-registry'
import type { RuntimeModelPricing } from '@shared/data/types/model'
import * as z from 'zod'

const PER_MILLION = 1_000_000

/** Token usage needed to price a language-model call. Subset of `MessageStats`. */
export interface LanguageCostUsage {
  inputTokens?: number
  outputTokens?: number
  inputTokenDetails?: {
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
}

export interface LanguageCostBreakdown {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface LanguageCostResult {
  cost: number
  breakdown: LanguageCostBreakdown
  currency: Currency
}

/**
 * Compute cost from token usage and the model's per-million-token pricing.
 *
 * Buckets:
 * - non-cached input (`noCacheTokens`, falling back to `inputTokens` when the
 *   provider gives no cache breakdown) priced at the input rate;
 * - cache read / cache write priced at their dedicated rates, falling back to
 *   the input rate when a dedicated rate is absent (Anthropic cache-read is
 *   discounted and cache-write is a premium, so the fallback is only a rough
 *   approximation — configure dedicated rates for accuracy);
 * - output at the output rate.
 *
 * Returns `undefined` when no bucket can be priced (no usable token + rate
 * pair), e.g. the model has no pricing configured.
 */
export function computeLanguageCost(
  usage: LanguageCostUsage,
  pricing: RuntimeModelPricing
): LanguageCostResult | undefined {
  const inputRate = pricing.input?.perMillionTokens ?? null
  const outputRate = pricing.output?.perMillionTokens ?? null
  const cacheReadRate = pricing.cacheRead?.perMillionTokens ?? inputRate
  const cacheWriteRate = pricing.cacheWrite?.perMillionTokens ?? inputRate

  const nonCacheInput = usage.inputTokenDetails?.noCacheTokens ?? usage.inputTokens
  const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens
  const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens
  const outputTokens = usage.outputTokens

  const breakdown: LanguageCostBreakdown = {}
  let cost = 0
  let priced = false

  const add = (key: keyof LanguageCostBreakdown, tokens: number | undefined, rate: number | null): void => {
    // Reject NaN/Infinity too (a corrupt/partially-parsed pricing snapshot): a
    // NaN rate would flip `priced` true and poison every SUM(cost) aggregate
    // (SQLite propagates NaN). Mirrors extractProviderCost's Number.isFinite guard.
    if (tokens == null || rate == null || !Number.isFinite(tokens) || !Number.isFinite(rate)) return
    const value = (tokens * rate) / PER_MILLION
    breakdown[key] = value
    cost += value
    priced = true
  }

  add('input', nonCacheInput, inputRate)
  add('cacheRead', cacheReadTokens, cacheReadRate)
  add('cacheWrite', cacheWriteTokens, cacheWriteRate)
  add('output', outputTokens, outputRate)

  if (!priced) return undefined

  return { cost, breakdown, currency: pricing.input?.currency ?? CURRENCY.USD }
}

/**
 * Compute image-generation cost from the model's per-image pricing.
 *
 * Only the `'image'` unit (flat price per generated image; the default when
 * `unit` is omitted) is supported — `'pixel'`-unit pricing needs the rendered
 * dimensions, which the generation result does not carry; those models return
 * `undefined` (no cost recorded) rather than a wrong number.
 */
export function computeImageCost(
  imageCount: number,
  pricing: RuntimeModelPricing
): { cost: number; currency: Currency } | undefined {
  const perImage = pricing.perImage
  if (!perImage || imageCount <= 0) return undefined
  if (perImage.unit !== undefined && perImage.unit !== 'image') return undefined
  return { cost: imageCount * perImage.price, currency: pricing.input?.currency ?? CURRENCY.USD }
}

const finiteCost = z.number().refine(Number.isFinite)
const ProviderCostSchema = z.union([
  z.object({ cost: finiteCost }),
  z.object({ usage: z.object({ cost: finiteCost }) })
])

export function extractProviderCost(raw: Record<string, unknown> | undefined): number | undefined {
  const parsed = ProviderCostSchema.safeParse(raw)
  if (!parsed.success) return undefined
  return 'cost' in parsed.data ? parsed.data.cost : parsed.data.usage.cost
}
