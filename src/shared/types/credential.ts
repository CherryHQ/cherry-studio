import * as z from 'zod'

export const CredentialIdSchema = z.uuid()
export const CredentialKindSchema = z.enum(['application', 'user-authorization'])
export const CredentialDomainSchema = z.enum(['feishu', 'lark'])
const NonBlankSchema = z.string().trim().min(1).max(4096)

export const FeishuApplicationInputSchema = z.strictObject({
  label: NonBlankSchema.max(256),
  domain: CredentialDomainSchema,
  appId: NonBlankSchema.max(256),
  appSecret: NonBlankSchema,
  encryptKey: NonBlankSchema.optional(),
  verificationToken: NonBlankSchema.optional()
})

export const ReplaceFeishuApplicationSchema = z
  .strictObject({
    id: CredentialIdSchema,
    appSecret: NonBlankSchema.optional(),
    encryptKey: NonBlankSchema.nullable().optional(),
    verificationToken: NonBlankSchema.nullable().optional()
  })
  .refine(
    (input) => input.appSecret !== undefined || input.encryptKey !== undefined || input.verificationToken !== undefined
  )

export const CredentialSummarySchema = z.union([
  z.strictObject({
    id: CredentialIdSchema,
    status: z.literal('available'),
    connector: z.literal('feishu'),
    kind: z.literal('application'),
    label: z.string(),
    domain: CredentialDomainSchema,
    appId: z.string(),
    hasEncryptKey: z.boolean(),
    hasVerificationToken: z.boolean()
  }),
  z.strictObject({
    id: CredentialIdSchema,
    status: z.literal('available'),
    connector: z.literal('feishu'),
    kind: z.literal('user-authorization'),
    label: z.string()
  }),
  z.strictObject({ id: CredentialIdSchema, status: z.enum(['corrupt', 'unreadable']) })
])

export type CredentialSummary = z.infer<typeof CredentialSummarySchema>
export type FeishuApplicationInput = z.infer<typeof FeishuApplicationInputSchema>
export type ReplaceFeishuApplication = z.infer<typeof ReplaceFeishuApplicationSchema>
