import { CURRENCY, type Currency, type RuntimeModelPricing } from '@shared/data/types/model'
import * as z from 'zod'

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
