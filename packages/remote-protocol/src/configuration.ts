import * as z from 'zod'

import { remoteFailureSchema } from './errors'
import { decimal, digest, opaqueId } from './values'

export const configurationAuthorizationSchema = z.looseObject({ domain: z.literal('configuration'), grantId: opaqueId })
export const configurationMethods = {
  'configuration.export.prepare': {
    params: z.strictObject({}),
    result: z.looseObject({ exportId: opaqueId, byteLength: decimal, sha256: digest }),
    errors: remoteFailureSchema
  },
  'configuration.export.read': {
    params: z.strictObject({ exportId: opaqueId, offset: decimal, maxBytes: z.number().int().min(1).max(24_576) }),
    result: z.looseObject({
      exportId: opaqueId,
      offset: decimal,
      nextOffset: decimal,
      dataBase64: z.string().max(32_768),
      eof: z.boolean()
    }),
    errors: remoteFailureSchema
  }
}
export type ConfigurationAuthorization = z.infer<typeof configurationAuthorizationSchema>
