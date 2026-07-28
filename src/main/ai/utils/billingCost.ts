import { CURRENCY, type Currency, objectValues } from '@shared/data/types/model'
import * as z from 'zod'

const finiteNonnegativeCost = z.number().nonnegative().refine(Number.isFinite)

const ProviderCostWithCurrencySchema = z.union([
  z.object({
    cost: finiteNonnegativeCost,
    currency: z.enum(objectValues(CURRENCY))
  }),
  z.object({
    usage: z.object({
      cost: finiteNonnegativeCost,
      currency: z.enum(objectValues(CURRENCY))
    })
  })
])

export function extractProviderCostWithCurrency(
  raw: Record<string, unknown> | undefined
): { amount: number; currency: Currency } | undefined {
  const parsed = ProviderCostWithCurrencySchema.safeParse(raw)
  if (!parsed.success) return undefined
  const value = 'cost' in parsed.data ? parsed.data : parsed.data.usage
  return { amount: value.cost, currency: value.currency }
}
