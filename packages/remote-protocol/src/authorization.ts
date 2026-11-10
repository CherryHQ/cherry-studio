import * as z from 'zod'

import { opaqueId } from './values'

export const remoteCapabilitySchema = z.enum(['configuration', 'agent'])
export const remoteCapabilitiesSchema = z
  .array(remoteCapabilitySchema)
  .min(1)
  .max(2)
  .refine((values) => new Set(values).size === values.length, 'Capabilities must be unique')
export const remoteGrantSchema = z.strictObject({ domain: remoteCapabilitySchema, grantId: opaqueId })
export const remoteAuthorizationSchema = z.strictObject({
  grants: z
    .array(remoteGrantSchema)
    .min(1)
    .max(2)
    .refine(
      (values) => new Set(values.map((value) => value.domain)).size === values.length,
      'Grant domains must be unique'
    )
})
export type RemoteCapability = z.infer<typeof remoteCapabilitySchema>
export type RemoteAuthorization = z.infer<typeof remoteAuthorizationSchema>
