import type { RuntimeModelPricing } from '@shared/data/types/model'
import { billingTimeMinutes, type BillingResolution, type ProviderBilling } from '@shared/data/types/providerBilling'

export function resolveProviderBilling(
  pricing: RuntimeModelPricing | null | undefined,
  billing: ProviderBilling | undefined,
  modelId: string,
  startedAt: Date | null
): { pricing: RuntimeModelPricing | null; billing?: BillingResolution } {
  if (!billing) return { pricing: pricing ? structuredClone(pricing) : null }
  const resolution: BillingResolution = {
    mode: 'multiplier',
    multiplier: billing.defaultMultiplier,
    timeZone: billing.timeZone,
    reason: 'default',
    ...(startedAt ? { pricedAt: startedAt.toISOString() } : {})
  }
  if (billing.scheduleEnabled && billing.periods.length > 0) {
    if (!startedAt) {
      const coveredMinutes = billing.periods.reduce((total, { start, end }) => {
        const duration = billingTimeMinutes(end) - billingTimeMinutes(start)
        return total + (duration > 0 ? duration : duration + 1440)
      }, 0)
      // Legacy model-price rules use the default multiplier for this time-independent estimate.
      const defaultApplies = coveredMinutes < 1440 || billing.periods.some((period) => period.mode === 'prices')
      const peak = billing.periods
        .filter((period) => period.mode === 'multiplier')
        .sort((a, b) => b.multiplier - a.multiplier)[0]
      resolution.reason = 'peak_fallback'
      if (peak && (!defaultApplies || peak.multiplier > billing.defaultMultiplier)) {
        resolution.multiplier = peak.multiplier
        resolution.periodId = peak.id
        resolution.periodName = peak.name
      }
    } else {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: billing.timeZone,
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit'
      }).formatToParts(startedAt)
      const minute =
        Number(parts.find((part) => part.type === 'hour')?.value) * 60 +
        Number(parts.find((part) => part.type === 'minute')?.value)
      const period = billing.periods.find(({ start, end }) => {
        const from = billingTimeMinutes(start)
        const to = billingTimeMinutes(end)
        return to > from ? minute >= from && minute < to : minute >= from || minute < to
      })
      if (period) {
        resolution.periodId = period.id
        resolution.periodName = period.name
        resolution.reason = 'period'
        if (period.mode === 'prices') {
          const override = period.models.find((model) => model.modelId === modelId)
          if (override) {
            delete resolution.multiplier
            return { pricing: structuredClone(override.pricing), billing: { ...resolution, mode: 'prices' } }
          }
          resolution.reason = 'model_fallback'
        } else resolution.multiplier = period.multiplier
      }
    }
  }
  if (!pricing) return { pricing: null, billing: resolution }
  const effective = structuredClone(pricing)
  const multiplier = resolution.multiplier ?? 1
  for (const rates of [effective, ...(effective.inputTokenTiers ?? [])]) {
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
      const rate = rates[key]
      if (rate?.perMillionTokens != null) rate.perMillionTokens *= multiplier
    }
  }
  if (effective.perImage) effective.perImage.price *= multiplier
  if (effective.perMinute) effective.perMinute.price *= multiplier
  return { pricing: effective, billing: resolution }
}
