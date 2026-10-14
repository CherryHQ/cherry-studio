import * as z from 'zod'

import { RuntimeModelPricingSchema } from './model'

const multiplierSchema = z.number().nonnegative().refine(Number.isFinite)
const startTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
const endTimeSchema = z.union([startTimeSchema, z.literal('24:00')])

export function billingTimeMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

const periodFields = {
  id: z.string().min(1),
  name: z.string().trim().min(1),
  start: startTimeSchema,
  end: endTimeSchema
}

export const ProviderBillingPeriodSchema = z.discriminatedUnion('mode', [
  z.strictObject({ ...periodFields, mode: z.literal('multiplier'), multiplier: multiplierSchema }),
  z.strictObject({
    ...periodFields,
    mode: z.literal('prices'),
    models: z.array(z.strictObject({ modelId: z.string().min(1), pricing: RuntimeModelPricingSchema }))
  })
])
export type ProviderBillingPeriod = z.infer<typeof ProviderBillingPeriodSchema>

export const ProviderBillingSchema = z
  .strictObject({
    defaultMultiplier: multiplierSchema,
    scheduleEnabled: z.boolean(),
    timeZone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
        return true
      } catch {
        return false
      }
    }, 'time_zone'),
    periods: z.array(ProviderBillingPeriodSchema)
  })
  .superRefine(({ periods }, ctx) => {
    const intervals: Array<{ start: number; end: number; index: number }> = []
    const ids = new Set<string>()
    periods.forEach((period, index) => {
      const issue = (field: string, message: string) =>
        ctx.addIssue({ code: 'custom', path: ['periods', index, field], message })
      if (ids.has(period.id)) issue('id', 'duplicate')
      ids.add(period.id)
      const start = billingTimeMinutes(period.start)
      const end = billingTimeMinutes(period.end)
      if (start === end) issue('end', 'same_time')
      if (end > start) intervals.push({ start, end, index })
      else if (end < start) {
        intervals.push({ start, end: 1440, index })
        if (end > 0) intervals.push({ start: 0, end, index })
      }
      if (period.mode === 'prices') {
        const models = new Set<string>()
        period.models.forEach((model, modelIndex) => {
          if (models.has(model.modelId)) {
            ctx.addIssue({
              code: 'custom',
              path: ['periods', index, 'models', modelIndex, 'modelId'],
              message: 'duplicate'
            })
          }
          models.add(model.modelId)
        })
      }
    })
    intervals.sort((a, b) => a.start - b.start)
    for (let i = 1; i < intervals.length; i++) {
      if (intervals[i].start < intervals[i - 1].end) {
        ctx.addIssue({ code: 'custom', path: ['periods', intervals[i].index, 'start'], message: 'overlap' })
      }
    }
  })
export type ProviderBilling = z.infer<typeof ProviderBillingSchema>

export const BillingResolutionSchema = z.strictObject({
  mode: z.enum(['multiplier', 'prices']),
  multiplier: multiplierSchema.optional(),
  timeZone: z.string(),
  periodId: z.string().optional(),
  periodName: z.string().optional(),
  reason: z.enum(['default', 'period', 'model_fallback', 'unknown_start', 'peak_fallback']),
  pricedAt: z.iso.datetime().optional()
})
export type BillingResolution = z.infer<typeof BillingResolutionSchema>
