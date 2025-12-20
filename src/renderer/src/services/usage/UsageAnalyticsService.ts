import type { UsageCategory, UsageEvent, UsageModule } from '@renderer/types'
import dayjs from 'dayjs'

export type UsageBucket = 'day' | 'week' | 'month'

export type UsageTotals = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  imageCount: number
  eventCount: number
  costProviderByCurrency: Record<string, number>
  costPricingByCurrency: Record<string, number>
}

export type UsageFilters = {
  modules?: UsageModule[]
  categories?: UsageCategory[]
  providerIds?: string[]
  modelIds?: string[]
}

export type UsageTrendPoint = {
  bucketStart: number
  totals: UsageTotals
}

export type UsageGroupRow = {
  key: string
  label: string
  module?: UsageModule
  category?: UsageCategory
  providerId?: string
  modelId?: string
  modelName?: string
  totals: UsageTotals
}

const emptyTotals = (): UsageTotals => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  imageCount: 0,
  eventCount: 0,
  costProviderByCurrency: {},
  costPricingByCurrency: {}
})

const addCurrencyAmount = (target: Record<string, number>, currency: string | undefined, amount: number) => {
  if (!currency) {
    return
  }
  target[currency] = (target[currency] || 0) + amount
}

export const filterUsageEvents = (events: UsageEvent[], filters: UsageFilters): UsageEvent[] => {
  const { modules, categories, providerIds, modelIds } = filters

  return events.filter((event) => {
    if (modules?.length && (!event.module || !modules.includes(event.module))) {
      return false
    }
    if (categories?.length && (!event.category || !categories.includes(event.category))) {
      return false
    }
    if (providerIds?.length && (!event.providerId || !providerIds.includes(event.providerId))) {
      return false
    }
    if (modelIds?.length && (!event.modelId || !modelIds.includes(event.modelId))) {
      return false
    }
    return true
  })
}

export const aggregateUsageTotals = (events: UsageEvent[]): UsageTotals => {
  const totals = emptyTotals()

  for (const event of events) {
    totals.eventCount += 1

    const promptTokens = event.promptTokens ?? 0
    const completionTokens = event.completionTokens ?? 0
    const totalTokens = event.totalTokens ?? promptTokens + completionTokens

    totals.promptTokens += promptTokens
    totals.completionTokens += completionTokens
    totals.totalTokens += totalTokens
    totals.imageCount += event.imageCount ?? 0

    if (event.costProvider !== undefined) {
      addCurrencyAmount(totals.costProviderByCurrency, event.currencyProvider, event.costProvider)
    }
    if (event.costPricing !== undefined) {
      addCurrencyAmount(totals.costPricingByCurrency, event.currencyPricing, event.costPricing)
    }
  }

  return totals
}

export const bucketUsageEvents = (events: UsageEvent[], bucket: UsageBucket): UsageTrendPoint[] => {
  const buckets = new Map<number, UsageTotals>()

  for (const event of events) {
    const bucketStart = dayjs(event.occurredAt).startOf(bucket).valueOf()
    if (!buckets.has(bucketStart)) {
      buckets.set(bucketStart, emptyTotals())
    }

    const totals = buckets.get(bucketStart)!
    const eventTotals = aggregateUsageTotals([event])

    totals.promptTokens += eventTotals.promptTokens
    totals.completionTokens += eventTotals.completionTokens
    totals.totalTokens += eventTotals.totalTokens
    totals.imageCount += eventTotals.imageCount
    totals.eventCount += eventTotals.eventCount

    for (const [currency, amount] of Object.entries(eventTotals.costProviderByCurrency)) {
      addCurrencyAmount(totals.costProviderByCurrency, currency, amount)
    }
    for (const [currency, amount] of Object.entries(eventTotals.costPricingByCurrency)) {
      addCurrencyAmount(totals.costPricingByCurrency, currency, amount)
    }
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([bucketStart, totals]) => ({ bucketStart, totals }))
}

export const groupUsageEvents = (events: UsageEvent[], getKey: (event: UsageEvent) => string): UsageGroupRow[] => {
  const groups = new Map<string, UsageGroupRow>()

  for (const event of events) {
    const key = getKey(event)
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: key,
        module: event.module,
        category: event.category,
        providerId: event.providerId,
        modelId: event.modelId,
        modelName: event.modelName,
        totals: emptyTotals()
      })
    }

    const group = groups.get(key)!
    group.totals.eventCount += 1

    const promptTokens = event.promptTokens ?? 0
    const completionTokens = event.completionTokens ?? 0
    const totalTokens = event.totalTokens ?? promptTokens + completionTokens

    group.totals.promptTokens += promptTokens
    group.totals.completionTokens += completionTokens
    group.totals.totalTokens += totalTokens
    group.totals.imageCount += event.imageCount ?? 0

    if (event.costProvider !== undefined) {
      addCurrencyAmount(group.totals.costProviderByCurrency, event.currencyProvider, event.costProvider)
    }
    if (event.costPricing !== undefined) {
      addCurrencyAmount(group.totals.costPricingByCurrency, event.currencyPricing, event.costPricing)
    }
  }

  return Array.from(groups.values())
}

export const groupUsageByModel = (events: UsageEvent[]): UsageGroupRow[] => {
  return groupUsageEvents(events, (event) => {
    if (event.modelId || event.modelName) {
      return `${event.providerId || 'unknown'}:${event.modelId || event.modelName}`
    }
    return `${event.module || 'unknown'}:unknown`
  }).map((row) => ({
    ...row,
    label: row.modelName || row.modelId || row.key
  }))
}

export const groupUsageByModule = (events: UsageEvent[]): UsageGroupRow[] => {
  return groupUsageEvents(events, (event) => event.module || 'unknown').map((row) => ({
    ...row,
    label: row.module || 'unknown'
  }))
}
