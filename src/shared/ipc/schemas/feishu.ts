import * as z from 'zod'

import { CredentialSummarySchema } from '@shared/types/credential'

import { defineRoute } from '../define'

export const feishuRequestSchemas = {
  'feishu.registration.begin': defineRoute({
    input: z
      .strictObject({
        requestId: z.uuid(),
        domain: z.enum(['feishu', 'lark']),
        purpose: z.enum(['channel', 'knowledge']),
        applicationCredentialId: z.uuid().optional()
      })
      .refine((input) => input.purpose !== 'knowledge' || input.domain === 'feishu'),
    output: z.strictObject({ registrationSessionId: z.uuid(), verificationUri: z.url(), expiresAt: z.iso.datetime() })
  }),
  'feishu.registration.complete': defineRoute({
    input: z.strictObject({ registrationSessionId: z.uuid() }),
    output: CredentialSummarySchema
  }),
  'feishu.registration.cancel': defineRoute({
    input: z.strictObject({ registrationSessionId: z.uuid() }),
    output: z.void()
  })
}
