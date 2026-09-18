import * as z from 'zod'

const BalanceUrlSchema = z.url({ protocol: /^https?$/ }).pipe(
  z.string().refine((value) => {
    const url = new URL(value)
    return !url.username && !url.password && !url.hash
  })
)

export const ProviderBalanceConfigSchema = z.object({
  enabled: z.boolean(),
  endpoint: BalanceUrlSchema,
  amountPath: z
    .string()
    .regex(/^[A-Za-z_\d]+(?:\.[A-Za-z_\d]+)*$/)
    .refine((path) => !path.split('.').some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))),
  currency: z.string().regex(/^[A-Z]{3}$/),
  rechargeUrl: z.union([BalanceUrlSchema, z.literal('')]).optional()
})

export type ProviderBalanceConfig = z.infer<typeof ProviderBalanceConfigSchema>

export const ProviderBalanceSchema = z.object({
  kind: z.enum(['account-balance', 'key-quota']),
  balances: z.array(z.object({ currency: z.string().regex(/^[A-Z]{3}$/), amount: z.number() })).min(1),
  updatedAt: z.iso.datetime(),
  rechargeUrl: BalanceUrlSchema.optional()
})

export type ProviderBalance = z.infer<typeof ProviderBalanceSchema>
