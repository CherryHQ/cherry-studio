import * as z from 'zod'

import {
  CredentialIdSchema,
  CredentialKindSchema,
  CredentialSummarySchema,
  FeishuApplicationInputSchema,
  ReplaceFeishuApplicationSchema
} from '@shared/types/credential'

import { defineRoute } from '../define'

export const credentialRequestSchemas = {
  'credential.list': defineRoute({
    input: z.strictObject({ connector: z.literal('feishu').optional(), kind: CredentialKindSchema.optional() }),
    output: z.array(CredentialSummarySchema)
  }),
  'credential.feishu.create_application': defineRoute({
    input: FeishuApplicationInputSchema,
    output: CredentialSummarySchema
  }),
  'credential.feishu.replace_application': defineRoute({
    input: ReplaceFeishuApplicationSchema,
    output: CredentialSummarySchema
  }),
  'credential.remove': defineRoute({
    input: z.strictObject({ id: CredentialIdSchema }),
    output: z.enum(['removed', 'missing'])
  })
}
