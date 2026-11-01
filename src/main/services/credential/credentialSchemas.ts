import * as z from 'zod'

import { CredentialIdSchema, FeishuApplicationInputSchema } from '@shared/types/credential'

export const FeishuApplicationPayloadSchema = FeishuApplicationInputSchema.omit({ label: true })
export const CredentialTokenSetSchema = z.strictObject({
  accessToken: z.string().trim().min(1),
  refreshToken: z.string().trim().min(1),
  accessTokenExpiresAt: z.number().int().positive(),
  refreshTokenExpiresAt: z.number().int().positive(),
  grantedScopes: z.array(z.string().trim().min(1)).max(256)
})
const common = {
  id: CredentialIdSchema,
  connector: z.literal('feishu'),
  label: z.string().trim().min(1).max(256)
}
const ApplicationRecordSchema = z.strictObject({
  ...common,
  kind: z.literal('application'),
  payload: FeishuApplicationPayloadSchema
})
const UserAuthorizationRecordSchema = z.strictObject({
  ...common,
  kind: z.literal('user-authorization'),
  payload: z.strictObject({
    applicationCredentialId: CredentialIdSchema,
    tokens: CredentialTokenSetSchema.nullable()
  })
})
export const CredentialRecordSchema = z.discriminatedUnion('kind', [
  ApplicationRecordSchema,
  UserAuthorizationRecordSchema
])
export type ApplicationCredential = z.infer<typeof ApplicationRecordSchema>
export type CredentialRecord = z.infer<typeof CredentialRecordSchema>
export type NewCredential =
  | Omit<ApplicationCredential, 'id'>
  | Omit<z.infer<typeof UserAuthorizationRecordSchema>, 'id'>
export type CredentialTokenSet = z.infer<typeof CredentialTokenSetSchema>
