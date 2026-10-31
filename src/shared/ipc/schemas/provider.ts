import * as z from 'zod'

import { defineRoute } from '../define'
import { LogoImageIntentSchema } from './entityImage'

export const SubscriptionQuotaWindowSchema = z.object({
  usedPercentage: z.number(),
  usedAmount: z.number().optional(),
  totalAmount: z.number().optional(),
  unit: z.string().optional(),
  resetsAt: z.string().optional(),
  resetsInFormatted: z.string().optional()
})
export type SubscriptionQuotaWindow = z.infer<typeof SubscriptionQuotaWindowSchema>

export const SubscriptionQuotaResultSchema = z.object({
  providerId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  source: z.enum(['http', 'cli', 'mock', 'none']),
  fiveHour: SubscriptionQuotaWindowSchema.optional(),
  sevenDay: SubscriptionQuotaWindowSchema.optional(),
  resets: z
    .object({
      totalCount: z.number().optional(),
      usedCount: z.number().optional(),
      remainingCount: z.number().optional(),
      resetInterval: z.string().optional(),
      nextResetAt: z.string().optional()
    })
    .optional(),
  rawOutput: z.string().optional(),
  updatedAt: z.string()
})
export type SubscriptionQuotaResult = z.infer<typeof SubscriptionQuotaResultSchema>

/**
 * Provider imperative IPC commands. `provider.set_logo` sends business intent +
 * raw bytes (a logo edit can't go through DataApi, which carries no bytes); the
 * main handler delegates to `setProviderLogo`, which creates the `file_entry`,
 * binds it via the provider's `file_ref` slot, and compensates on failure.
 */
export const providerRequestSchemas = {
  'provider.set_logo': defineRoute({
    input: z.strictObject({ providerId: z.string().min(1), image: LogoImageIntentSchema }),
    output: z.void()
  }),
  'provider.get_subscription_quota': defineRoute({
    input: z.strictObject({
      providerId: z.string().min(1),
      method: z.enum(['auto', 'http', 'cli']).optional(),
      cliCommand: z.string().optional(),
      httpUrl: z.string().optional()
    }),
    output: SubscriptionQuotaResultSchema
  })
}
