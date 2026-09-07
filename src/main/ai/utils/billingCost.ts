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

const ProviderCostSchema = z.union([
  z.object({
    cost: finiteNonnegativeCost
  }),
  z.object({
    usage: z.object({
      cost: finiteNonnegativeCost
    })
  })
])

function carriesCurrency(raw: Record<string, unknown> | undefined): boolean {
  if (!raw) return false
  if ('currency' in raw) return true
  const usage = raw.usage
  return typeof usage === 'object' && usage !== null && 'currency' in usage
}

export function extractProviderCostWithCurrency(
  raw: Record<string, unknown> | undefined,
  reportedCostCurrency?: Currency | null
): { amount: number; currency: Currency } | undefined {
  const withCurrency = ProviderCostWithCurrencySchema.safeParse(raw)
  if (withCurrency.success) {
    const value = 'cost' in withCurrency.data ? withCurrency.data : withCurrency.data.usage
    return { amount: value.cost, currency: value.currency }
  }

  if (!reportedCostCurrency || carriesCurrency(raw)) return undefined
  const amountOnly = ProviderCostSchema.safeParse(raw)
  if (!amountOnly.success) return undefined
  const value = 'cost' in amountOnly.data ? amountOnly.data : amountOnly.data.usage
  return { amount: value.cost, currency: reportedCostCurrency }
}
